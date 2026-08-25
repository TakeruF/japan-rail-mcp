# Data-source assessment

Assessment date: 2026-08-25.

| Source                                        | Key / contract                                                            | Shinkansen                                                                 | Realtime / availability                         | Reuse decision                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bundled station catalog                       | None                                                                      | Major stations across all current Shinkansen networks                      | No                                              | Ship factual station metadata with source links and a catalog revision date. No timetable data is bundled.                                       |
| Ekispert API Standard Plan                    | User-supplied access key and a direct agreement with Val Laboratory       | Route, timetable, fares, seat types, and stops are documented              | No seat inventory                               | Optional live provider. The free plan does not include the core route-search API. Users are responsible for plan limits and display/reuse terms. |
| ODPT / Public Transportation Open Data Center | Registration and API key; dataset-specific licenses                       | The current JR East train-timetable dataset explicitly excludes Shinkansen | Some datasets are dynamic                       | Not used for the Shinkansen MVP. A future provider can be added only per dataset license.                                                        |
| GTFS-JP v4                                    | Specification only; feed licenses vary                                    | The specification supports rail data, but it is not a nationwide feed      | GTFS Realtime is supported by the specification | Provider interface is GTFS-ready; no nationwide Shinkansen feed was identified.                                                                  |
| JR operator timetable pages/PDFs              | Public viewing; no general-purpose API or redistribution grant identified | Yes                                                                        | Published schedules, not inventory              | Used only as human-verification links. The server does not scrape or redistribute them.                                                          |

## Primary references

- Ekispert route API: <https://docs.ekispert.com/v1/api/search/course/extreme.html>
- Ekispert station-light API: <https://docs.ekispert.com/v1/api/station/light.html>
- Ekispert free-plan FAQ: <https://docs.ekispert.com/v1/le/faq/>
- Ekispert terms: <https://docs.ekispert.com/v1/WebService_TOS.pdf>
- ODPT developer site and rules: <https://developer.odpt.org/> and
  <https://developer.odpt.org/terms>
- ODPT JR East timetable dataset (states that Shinkansen is excluded):
  <https://ckan.odpt.org/en/dataset/jreast__r_train_timetable>
- MLIT GTFS-JP v4: <https://www.mlit.go.jp/commmmons/document/007/>
- JR Central Shinkansen travel information: <https://global.jr-central.co.jp/en/info/>
- JR East Shinkansen routes: <https://www.jreast.co.jp/en/multi/traininformation/index.html>
- JR West Sanyo/Kyushu Shinkansen: <https://www.westjr.co.jp/global/en/shinkansen/sanyo-kyushu-shinkansen/>
- JR Kyushu route map: <https://www.jrkyushu.co.jp/english/pdf/jrkyushu_routemap_en.pdf>

## Important limitation

Provider availability is not the same as permission to redistribute provider data. This project
ships integration code, not an API key, data sublicense, service-level agreement, or blanket grant
for commercial reuse. A deployment operator must review the contract attached to their own key.
