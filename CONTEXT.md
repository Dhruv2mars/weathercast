# Weathercast Domain Context

Weathercast means rain nowcasting, not general weather forecasting. The public promise covers the next 0–120 minutes. A nowcast contains a location, issue time, 15-minute precipitation intervals, rain onset and end windows, peak intensity, confidence, freshness, provider provenance, and a data-quality tier.

Core vocabulary:

- `clear window`: time until the first likely rain interval.
- `rain event`: consecutive wet intervals separated by no more than one dry interval.
- `onset window`: bounded range around the first likely wet interval.
- `data tier`: Precision when radar and dense observations exist, Enhanced when regional model/satellite inputs exist, Standard for global numerical guidance.
- `confidence`: calibrated trust in a specific result, not forecast probability alone.
- `stale`: a cached nowcast older than its provider-specific freshness threshold.

Product claims must be measurable. Never claim global or street-level superiority without an archived benchmark showing the named metric, location, time period, and comparison method.
