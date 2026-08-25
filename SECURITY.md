# Security policy

`japan-rail-mcp` is read-only. It does not buy tickets, make reservations, accept railway-account
credentials, bypass CAPTCHA, or automate operator websites.

Keep `EKISPERT_API_KEY` outside source control. The server sends it only to the configured Ekispert
API base URL and never includes it in tool output or errors. Report suspected credential exposure
privately to the repository maintainer rather than opening a public issue.
