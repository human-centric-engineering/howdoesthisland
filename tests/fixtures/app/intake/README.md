# Intake fixtures

The binary fixtures (`*.pdf`, `*.docx`, `*.pptx`) are built by `make-fixtures.py`.

`gov-uk-register-to-vote.html` is a real page, saved unchanged on 2026-11-13
from <https://www.gov.uk/register-to-vote>, so `fetchPage()`'s main-content
rule is tested against real site chrome: a cookie banner, a search form, a
header and a footer. It contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
