# Learning Hub acquisition sources

Reviewed 2026-11-06. These records are links, publisher titles and editorial technology tags, not copies of lessons or enrollment entitlements. Ratings, review counts, prices and duration are not imported. Existing course IDs and private saved snapshots are preserved.

## Automated structured source

freeCodeCamp contributors publish the [curriculum structure](https://raw.githubusercontent.com/freeCodeCamp/freeCodeCamp/main/curriculum/structure/curriculum.json) and [English title metadata](https://raw.githubusercontent.com/freeCodeCamp/freeCodeCamp/main/client/i18n/locales/english/intro.json) under their [BSD-3-Clause license](https://raw.githubusercontent.com/freeCodeCamp/freeCodeCamp/main/LICENSE.md), retained in [freeCodeCamp.LICENSE](freeCodeCamp.LICENSE). The adapter extracts only titles for reviewed, mapped curriculum entries present in the official structure. It does not copy introductions, challenges, solutions or media, or guess URLs/topics for unreviewed slugs. See the publisher's [structure documentation](https://contribute.freecodecamp.org/curriculum-file-structure/).

Two fixed public JSON URLs are fetched at most daily after success, under a durable four-HTTP-request/day budget. Schema, response size, timeouts, redirects, leases and fencing are enforced. Failures back off without extending last-good freshness. Missing entries retain their identities pending link audit/curation. Source content hashes and attribution are persisted with the Mongo publication. New unreviewed curricula require a reviewed mapping before import.

## Controlled curation

- MDN contributors: [core modules](https://developer.mozilla.org/en-US/curriculum/core/) and [extensions](https://developer.mozilla.org/en-US/curriculum/extensions/). The [MDN curriculum license](https://github.com/mdn/curriculum/blob/main/LICENSE.md) identifies CC-BY-SA 2.5 prose. This catalog links to MDN; descriptions are original editorial labels, not copied learning outcomes or lessons. No undocumented MDN search API is used.
- Udemy: [AI Engineer Core Track](https://www.udemy.com/course/llm-engineering-master-ai-and-large-language-models/). Link-only curation; no affiliate/business API access or license to republish course content is assumed.
- Coursera: [Generative AI with Large Language Models](https://www.coursera.org/learn/generative-ai-with-llms), [RAG](https://www.coursera.org/learn/retrieval-augmented-generation-rag), [IBM containers](https://www.coursera.org/learn/ibm-containers-docker-kubernetes-openshift), [Getting Started with Angular](https://www.coursera.org/learn/getting-started-with-angular), [Introduction to Angular](https://www.coursera.org/learn/introduction-to-angular). Link-only curation; no private API access or subscription/enrollment claims.
- edX / IBM: [Generative AI Engineering](https://www.edx.org/certificates/professional-certificate/ibm-generative-ai-engineering). Program-level link, not an individual course. Enrollment, region and current availability must be confirmed with the provider.
- The Odin Project and Full Stack Open retain their previously reviewed links and require controlled curation. They are not falsely registered as searchable APIs.
- YouTube retains its authorized official API adapter, existing quotas, quality/relevance checks, breaker and topic fencing. No video or licensed content is downloaded.

Unsupported topic/provider combinations remain explicit coverage gaps. Microsoft Learn is not enabled without authorized access. Publisher listings can change or require authentication; successful link resolution does not certify enrollment. Link failures are audited with existing safe archival rules, never by rewriting saved progress identities.
