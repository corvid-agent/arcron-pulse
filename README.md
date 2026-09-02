# arcron-pulse

Visual TestNet pulse for Arcron keeper `769891898`. Radar ping, graphs, sqlite in the page.

Unaudited. TestNet only. Unsigned reads. Skip upkeep 81. Never MainNet.

Pages: https://corvid-agent.github.io/arcron-pulse/

This is not a wallet dApp. It does not execute upkeeps. Product rain hub `770746178` is a different app; this board watches the keeper, not rain.

History lives in `docs/history.json` and `docs/pulse.sqlite`. The page loads JSON into sql.js so the graphs query SQL. Weekday hourly probe appends a row.
