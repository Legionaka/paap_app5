export const WEATHER_TIME_ZONE = 'Africa/Johannesburg';

export function windDirection(degrees) {
  const directions = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return directions[Math.round(degrees / 22.5) % directions.length];
}

export function weatherDescription(code) {
  if (code === 0) return 'Clear sky';
  if ([1, 2].includes(code)) return 'Mostly clear';
  if (code === 3) return 'Overcast';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain showers';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorms';
  return 'Conditions unavailable';
}

export function weatherSymbol(code) {
  if (code === 0) return '\u2600';
  if ([1, 2].includes(code)) return '\u25d0';
  if ([45, 48, 51, 53, 55].includes(code)) return '\u2601';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '\u2614';
  if ([95, 96, 99].includes(code)) return '\u26c8';
  return '\u2601';
}

function parseForecastTime(value) {
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+02:00`);
}

function formatHour(date) {
  return new Intl.DateTimeFormat('en-ZA', {
    hour: '2-digit',
    timeZone: WEATHER_TIME_ZONE,
  }).format(date);
}

export function buildFishingWindows(daily, hourly, currentTime) {
  const now = parseForecastTime(currentTime).getTime();
  const describeWindow = (sunTime, period) => {
    const target = parseForecastTime(sunTime).getTime();
    let closestIndex = -1;
    let closestDistance = Infinity;
    hourly.time.forEach((time, index) => {
      const distance = Math.abs(parseForecastTime(time).getTime() - target);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    if (closestIndex < 0 || closestDistance > 90 * 60 * 1000) {
      return {
        period,
        timestamp: sunTime,
        time: formatHour(parseForecastTime(sunTime)),
        label: 'Forecast unavailable',
        score: Infinity,
      };
    }

    const wind = hourly.wind_speed_10m[closestIndex];
    const rain = hourly.precipitation_probability[closestIndex];
    const code = hourly.weather_code[closestIndex];
    const storm = [95, 96, 99].includes(code);
    const label = storm
      ? 'Storms forecast · recheck conditions'
      : wind >= 30
        ? 'Very windy forecast'
        : rain >= 60
          ? 'Rain likely'
          : wind <= 18 && rain < 25
            ? 'Lower wind · low rain chance'
            : 'Mixed weather outlook';
    return {
      period,
      timestamp: sunTime,
      time: formatHour(parseForecastTime(sunTime)),
      label,
      score: (storm ? 100 : 0) + wind + rain * 0.2,
    };
  };

  const days = [];
  const windows = [];
  for (let index = 0; index < daily.time.length; index += 1) {
    const date = daily.time[index];
    const dateObject = parseForecastTime(`${date}T12:00:00`);
    const periods = [
      describeWindow(daily.sunrise[index], 'Dawn'),
      describeWindow(daily.sunset[index], 'Dusk'),
    ].filter((window) => parseForecastTime(window.timestamp).getTime() >= now);
    if (!periods.length) continue;
    const dayLabel = new Intl.DateTimeFormat('en-ZA', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: WEATHER_TIME_ZONE,
    }).format(dateObject);
    days.push({ date, label: dayLabel, periods });
    windows.push(...periods.map((period) => ({ ...period, date })));
  }

  const recommended = windows
    .filter((window) => Number.isFinite(window.score))
    .sort((a, b) => a.score - b.score)[0];
  const recommendation = recommended
    ? `Most favourable weather outlook: ${new Intl.DateTimeFormat('en-ZA', {
        weekday: 'short',
        timeZone: WEATHER_TIME_ZONE,
      }).format(
        parseForecastTime(`${recommended.date}T12:00:00`),
      )} ${recommended.period.toLowerCase()} · weather-only comparison`
    : null;
  return { days, recommendation };
}

function renderHourlyForecast(hourly, currentTime) {
  const now = new Date(currentTime);
  const times = hourly.time
    .map((time, index) => ({ time: new Date(time), index }))
    .filter((item) => item.time >= now)
    .filter((_, index) => index % 2 === 0)
    .slice(0, 6);
  const container = document.querySelector('#hourlyForecast');
  container.replaceChildren();

  for (const { time, index } of times) {
    const item = document.createElement('div');
    item.className = 'hour';
    const label = document.createElement('span');
    label.textContent = index === times[0]?.index ? 'NOW' : formatHour(time);
    const icon = document.createElement('div');
    icon.className = 'sun-mini';
    icon.textContent = weatherSymbol(hourly.weather_code[index]);
    const temperature = document.createElement('strong');
    temperature.textContent = `${Math.round(hourly.temperature_2m[index])}°`;
    const wind = document.createElement('span');
    wind.className = 'hour-wind';
    wind.textContent = `${Math.round(hourly.wind_speed_10m[index])} km/h`;
    item.append(label, icon, temperature, wind);
    container.append(item);
  }
}

function renderFishingWindows(daily, hourly, currentTime) {
  const container = document.querySelector('#fishingWindows');
  container.replaceChildren();
  const { days, recommendation } = buildFishingWindows(daily, hourly, currentTime);
  if (!days.length) {
    container.textContent = 'No upcoming dawn or dusk window is available in this forecast.';
    return;
  }
  for (const dayData of days) {
    const day = document.createElement('div');
    day.className = 'fishing-window-day';
    const label = document.createElement('strong');
    label.textContent = dayData.label;
    day.append(label);
    for (const window of dayData.periods) {
      const row = document.createElement('span');
      row.textContent = `${window.period} · ${window.time} · ${window.label}`;
      day.append(row);
    }
    container.append(day);
  }
  if (recommendation) {
    const note = document.createElement('p');
    note.className = 'window-recommendation';
    note.textContent = recommendation;
    container.prepend(note);
  }
}

export async function loadWeather(coordinates) {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,weather_code',
    daily: 'sunrise,sunset',
    forecast_days: '2',
    timezone: WEATHER_TIME_ZONE,
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
  const data = await response.json();
  const modelTime = formatHour(new Date(data.current.time));
  document.querySelector('#currentTemperature').textContent =
    `${Math.round(data.current.temperature_2m)}°`;
  document.querySelector('#currentWeather').textContent = weatherDescription(
    data.current.weather_code,
  );
  document.querySelector('#currentWind').textContent =
    `${windDirection(data.current.wind_direction_10m)} ${Math.round(data.current.wind_speed_10m)} km/h`;
  document.querySelector('#currentWindSummary').textContent = `Model time ${modelTime}`;
  document.querySelector('#weatherUpdated').textContent = `Forecast model time ${modelTime}`;
  renderHourlyForecast(data.hourly, data.current.time);
  renderFishingWindows(data.daily, data.hourly, data.current.time);
}
