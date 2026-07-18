export const nowcastApiUrl = process.env.EXPO_PUBLIC_NOWCAST_API_URL?.replace(/\/$/, '');

export const forecastSourceInfo = nowcastApiUrl
  ? {
      title: 'Weathercast forecast service',
      body: 'Weathercast combines configured weather sources and returns the data tier and limitations with each forecast.',
    }
  : {
      title: 'Open-Meteo',
      body: 'Worldwide 15-minute numerical guidance for evaluation builds. Weather data by Open-Meteo.com.',
    };
