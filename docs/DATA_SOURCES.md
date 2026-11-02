# Data Sources & Asset Licences

Every real-world dataset and every third-party asset must have a row here. Data files in
`data/` must also have top-level `"source"` and `"asOf"` fields. Mark estimated values with
`"estimate": true`.

## Datasets

| File                 | Source                                                  | asOf       | Licence        | Notes                                                 |
| -------------------- | ------------------------------------------------------- | ---------- | -------------- | ----------------------------------------------------- |
| `data/scenario.json` | World War 3 game design (fictional scenario parameters) | 2026-11-02 | n/a (original) | Not real-world data. Start date and turn length only. |

## Assets (textures, models, fonts, audio)

| Path       | Source | Licence | Notes                                                                                                          |
| ---------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| _none yet_ |        |         | Planned: NASA Visible Earth Blue Marble / Black Marble (public domain), Natural Earth vectors (public domain). |

## Software dependencies

npm packages are listed in `package.json`. All are MIT, ISC, BSD or Apache-2.0.
