import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFishingWindows, weatherDescription, windDirection } from '../public/js/weather.js';

test('weather codes are presented as forecast descriptions', () => {
  assert.equal(weatherDescription(0), 'Clear sky');
  assert.equal(weatherDescription(61), 'Rain showers');
  assert.equal(weatherDescription(95), 'Thunderstorms');
  assert.equal(weatherDescription(999), 'Conditions unavailable');
});

test('wind bearings map to compass points', () => {
  assert.equal(windDirection(0), 'N');
  assert.equal(windDirection(90), 'E');
  assert.equal(windDirection(180), 'S');
  assert.equal(windDirection(270), 'W');
});

test('fishing windows discard past times and rank forecast weather only', () => {
  const daily = {
    time: ['2026-10-27', '2026-10-28'],
    sunrise: ['2026-10-27T05:30', '2026-10-28T05:31'],
    sunset: ['2026-10-27T18:30', '2026-10-28T18:29'],
  };
  const hourly = {
    time: ['2026-10-27T05:00', '2026-10-27T18:00', '2026-10-28T05:00', '2026-10-28T18:00'],
    wind_speed_10m: [7, 32, 12, 15],
    precipitation_probability: [5, 70, 10, 15],
    weather_code: [0, 95, 1, 2],
  };

  const result = buildFishingWindows(daily, hourly, '2026-10-27T06:00+02:00');

  assert.equal(result.days.length, 2);
  assert.deepEqual(
    result.days[0].periods.map((window) => window.period),
    ['Dusk'],
  );
  assert.match(result.days[0].periods[0].label, /Storms forecast/);
  assert.match(result.recommendation, /weather-only comparison/);
  assert.match(result.recommendation, /dawn/);
});
