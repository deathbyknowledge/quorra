export const HELP_MESSAGE = `CLU helps you nagivate the complexity of the Cloudflare API.
It pattern matches your command to a CF endpoint and makes the call for you.
Built with Workers, Durable Objects, Vectorize and Workers AI.

Usage: [command] <options>

Examples:
\tTarget endpoint: /accounts/1234/vectorize/indexes
\t\tCommand: ls vectorize indexes --accountId 1234

\tTarget endpoint: /zones/1234/rulesets/phases/http_request_firewall_custom/entrypoint
\t\tCommand: get ruleset --zone 1234 --phase http_request_firewall_custom
\n`;