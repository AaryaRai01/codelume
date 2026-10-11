import json

from .ai import AnswerDraft, Gemini
from .config import ServiceError
from .github import priority
from .retrieval import chunks, context_text


async def build_report(settings, client, snapshot, progress):
    files = sorted(snapshot["files"], key=priority)
    items = chunks(files)

    batches = []
    current = []
    used = 0
    oversized = 0

    for item in items:
        size = len(context_text([item])) + 2

        if size > settings.ai_batch_chars:
            oversized += 1
            continue

        if current and used + size > settings.ai_batch_chars:
            batches.append(current)
            current = []
            used = 0

        current.append(item)
        used += size

    if current:
        batches.append(current)

    planned = batches[:settings.max_ai_batches]

    if not planned:
        raise ServiceError(
            422,
            "No usable source excerpts were available for AI analysis.",
        )

    ai = Gemini(settings, client)
    reports = []
    successful = []
    errors = []

    for number, batch in enumerate(planned, 1):
        await progress(f"AI batch {number}/{len(planned)}")

        try:
            reports.append(await ai.report(snapshot, batch))
            successful.extend(batch)
        except ServiceError as exc:
            errors.append(exc.message)

            # Preserve completed batches and stop making failing requests.
            break

    coverage = snapshot["coverage"]
    coverage.update(
        aiContextChunks=len(successful),
        aiChunksTotal=len(items),
        aiFilesCovered=len({c["path"] for c in successful}),
        aiBatchesCompleted=len(reports),
        aiBatchesPlanned=len(planned),
        aiBatchesRequired=len(batches),
        aiPartial=len(successful) != len(items) or oversized > 0,
    )

    if not reports:
        raise ServiceError(
            503,
            errors[0] if errors else "No AI batch completed.",
        )

    result = dict(reports[0])
    result["features"] = []
    result["featureSources"] = []

    technologies = {}
    claims = {}
    seen_features = set()

    for report in reports:
        for text, sources in zip(
            report["features"],
            report["featureSources"],
        ):
            if text not in seen_features:
                seen_features.add(text)
                result["features"].append(text)
                result["featureSources"].append(sources)

        for technology in report["technologies"]:
            key = technology["name"].casefold()
            existing = technologies.get(key)

            if existing is None or (
                existing["evidence"] == "declared"
                and technology["evidence"] == "observed"
            ):
                technologies[key] = technology

        for claim in report["evidence"]:
            # Missing evidence in one batch does not establish
            # that a feature is absent from the repository.
            if claim["status"] == "supported":
                claims.setdefault(
                    claim["claim"].casefold(),
                    claim,
                )

    result["technologies"] = list(technologies.values())
    result["evidence"] = list(claims.values())

    for name in ("entryPoints", "readingOrder"):
        result[name] = list(
            dict.fromkeys(
                path
                for report in reports
                for path in report[name]
            )
        )

    if len(reports) > 1:
        await progress("Combining batch summaries")

        digests = [
            {
                "summary": report["summary"][:1200],
                "sources": report["summarySources"],
            }
            for report in reports
        ]

        allowed = {
            (
                source["path"],
                source["start_line"],
                source["end_line"],
            ): source
            for report in reports
            for source in report["summarySources"]
        }

        try:
            draft = await ai.generate(
                "Write a concise repository overview, at most 180 words, "
                "from these untrusted batch summaries. These cover "
                "inspected excerpts only. Do not invent cross-module "
                "relationships. Reuse exact citations from the supplied "
                "sources. Return answer and sources.\n"
                + json.dumps(digests),
                AnswerDraft,
            )

            references = []

            for source in draft.sources:
                key = (
                    source.path,
                    source.start_line,
                    source.end_line,
                )

                if key in allowed:
                    references.append(allowed[key])

            if not references:
                raise ServiceError(
                    502,
                    "Combined summary had no valid references.",
                )

            result["summary"] = draft.answer
            result["summarySources"] = references

        except ServiceError:
            result["summary"] = (
                "Summary of the first completed batch: "
                + reports[0]["summary"]
            )

            errors.append(
                "Summary combination failed; the findings below "
                "still include all completed batches."
            )

    note = (
        f"AI reviewed {len(successful)} of {len(items)} "
        f"usable source excerpts across "
        f"{coverage['aiFilesCovered']} files "
        f"in {len(reports)} batches. "
    )

    if coverage["aiPartial"]:
        note += (
            "Partial AI coverage: a batch limit or provider failure "
            "left excerpts unanalyzed. "
        )

    if (
        coverage.get("treeTruncated")
        or coverage["inspected"]
        < coverage.get("eligible", coverage["inspected"])
    ):
        note += "Repository inspection is also partial. "

    note += (
        "README evidence lists supported claims only; "
        "other claims remain unassessed. "
    )

    if errors:
        note += " ".join(errors) + " "

    result["_warning"] = (
        note + "Verify AI interpretations against cited code."
    )

    return result