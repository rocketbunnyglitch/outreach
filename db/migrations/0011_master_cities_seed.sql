-- =========================================================================
-- 0011_master_cities_seed.sql
--
-- Seeds the cities table with the master roster of US/Canada nightlife
-- markets we use as Halloween/St. Paddy's targets.
--
-- All rows are upserts on (country_code, region, name) — the existing
-- unique index — so re-running the migration is a no-op.
--
-- Timezones are IANA database identifiers.
-- Coordinates are city-center decimals (lat, lng).
--
-- countries table: assumes CA, US, GB exist. Inserts as needed.
-- =========================================================================

-- Required countries
INSERT INTO countries (code, name, default_currency)
VALUES
  ('CA', 'Canada', 'CAD'),
  ('US', 'United States', 'USD'),
  ('GB', 'United Kingdom', 'GBP')
ON CONFLICT (code) DO NOTHING;

-- Insert cities (skip duplicates)
WITH seed (country_code, region, name, timezone, lat, lng) AS (
  VALUES
    -- Canada
    ('CA', 'Ontario', 'Toronto',          'America/Toronto',    43.6532, -79.3832),
    ('CA', 'Ontario', 'Ottawa',           'America/Toronto',    45.4215, -75.6972),
    ('CA', 'Ontario', 'Hamilton',         'America/Toronto',    43.2557, -79.8711),
    ('CA', 'Ontario', 'London',           'America/Toronto',    42.9849, -81.2453),
    ('CA', 'Ontario', 'Kitchener',        'America/Toronto',    43.4516, -80.4925),
    ('CA', 'Ontario', 'Windsor',          'America/Toronto',    42.3149, -83.0364),
    ('CA', 'Quebec',  'Montreal',         'America/Toronto',    45.5017, -73.5673),
    ('CA', 'Quebec',  'Quebec City',      'America/Toronto',    46.8139, -71.2080),
    ('CA', 'Alberta', 'Calgary',          'America/Edmonton',   51.0447, -114.0719),
    ('CA', 'Alberta', 'Edmonton',         'America/Edmonton',   53.5461, -113.4938),
    ('CA', 'British Columbia', 'Vancouver','America/Vancouver', 49.2827, -123.1207),
    ('CA', 'British Columbia', 'Victoria', 'America/Vancouver', 48.4284, -123.3656),
    ('CA', 'Manitoba', 'Winnipeg',        'America/Winnipeg',   49.8951,  -97.1384),
    ('CA', 'Nova Scotia', 'Halifax',      'America/Halifax',    44.6488,  -63.5752),
    ('CA', 'Saskatchewan', 'Saskatoon',   'America/Regina',     52.1332, -106.6700),
    ('CA', 'Saskatchewan', 'Regina',      'America/Regina',     50.4452, -104.6189),

    -- United States (East)
    ('US', 'New York',     'New York City',    'America/New_York',     40.7128, -74.0060),
    ('US', 'New York',     'Buffalo',          'America/New_York',     42.8864, -78.8784),
    ('US', 'New York',     'Albany',           'America/New_York',     42.6526, -73.7562),
    ('US', 'New York',     'Rochester',        'America/New_York',     43.1566, -77.6088),
    ('US', 'New York',     'Syracuse',         'America/New_York',     43.0481, -76.1474),
    ('US', 'Massachusetts','Boston',           'America/New_York',     42.3601, -71.0589),
    ('US', 'Pennsylvania', 'Philadelphia',     'America/New_York',     39.9526, -75.1652),
    ('US', 'Pennsylvania', 'Pittsburgh',       'America/New_York',     40.4406, -79.9959),
    ('US', 'District of Columbia', 'Washington','America/New_York',    38.9072, -77.0369),
    ('US', 'Florida',      'Miami',            'America/New_York',     25.7617, -80.1918),
    ('US', 'Florida',      'Tampa',            'America/New_York',     27.9506, -82.4572),
    ('US', 'Florida',      'Orlando',          'America/New_York',     28.5383, -81.3792),
    ('US', 'Florida',      'Jacksonville',     'America/New_York',     30.3322, -81.6557),
    ('US', 'Georgia',      'Atlanta',          'America/New_York',     33.7490, -84.3880),
    ('US', 'North Carolina','Charlotte',       'America/New_York',     35.2271, -80.8431),
    ('US', 'North Carolina','Raleigh',         'America/New_York',     35.7796, -78.6382),
    ('US', 'Ohio',         'Columbus',         'America/New_York',     39.9612, -82.9988),
    ('US', 'Ohio',         'Cleveland',        'America/New_York',     41.4993, -81.6944),
    ('US', 'Ohio',         'Cincinnati',       'America/New_York',     39.1031, -84.5120),
    ('US', 'Michigan',     'Detroit',          'America/Detroit',      42.3314, -83.0458),
    ('US', 'Indiana',      'Indianapolis',     'America/Indiana/Indianapolis', 39.7684, -86.1581),

    -- United States (Central)
    ('US', 'Illinois',     'Chicago',          'America/Chicago',      41.8781, -87.6298),
    ('US', 'Wisconsin',    'Milwaukee',        'America/Chicago',      43.0389, -87.9065),
    ('US', 'Wisconsin',    'Madison',          'America/Chicago',      43.0731, -89.4012),
    ('US', 'Minnesota',    'Minneapolis',      'America/Chicago',      44.9778, -93.2650),
    ('US', 'Minnesota',    'Saint Paul',       'America/Chicago',      44.9537, -93.0900),
    ('US', 'Missouri',     'Saint Louis',      'America/Chicago',      38.6270, -90.1994),
    ('US', 'Missouri',     'Kansas City',      'America/Chicago',      39.0997, -94.5786),
    ('US', 'Tennessee',    'Nashville',        'America/Chicago',      36.1627, -86.7816),
    ('US', 'Tennessee',    'Memphis',          'America/Chicago',      35.1495, -90.0490),
    ('US', 'Texas',        'Austin',           'America/Chicago',      30.2672, -97.7431),
    ('US', 'Texas',        'Houston',          'America/Chicago',      29.7604, -95.3698),
    ('US', 'Texas',        'Dallas',           'America/Chicago',      32.7767, -96.7970),
    ('US', 'Texas',        'San Antonio',      'America/Chicago',      29.4241, -98.4936),
    ('US', 'Louisiana',    'New Orleans',      'America/Chicago',      29.9511, -90.0715),
    ('US', 'Oklahoma',     'Oklahoma City',    'America/Chicago',      35.4676, -97.5164),
    ('US', 'Iowa',         'Des Moines',       'America/Chicago',      41.5868, -93.6250),

    -- United States (Mountain)
    ('US', 'Colorado',     'Denver',           'America/Denver',       39.7392, -104.9903),
    ('US', 'Colorado',     'Boulder',          'America/Denver',       40.0150, -105.2705),
    ('US', 'Utah',         'Salt Lake City',   'America/Denver',       40.7608, -111.8910),
    ('US', 'Arizona',      'Phoenix',          'America/Phoenix',      33.4484, -112.0740),
    ('US', 'Arizona',      'Tucson',           'America/Phoenix',      32.2226, -110.9747),

    -- United States (West)
    ('US', 'California',   'Los Angeles',      'America/Los_Angeles',  34.0522, -118.2437),
    ('US', 'California',   'San Francisco',    'America/Los_Angeles',  37.7749, -122.4194),
    ('US', 'California',   'San Diego',        'America/Los_Angeles',  32.7157, -117.1611),
    ('US', 'California',   'Sacramento',       'America/Los_Angeles',  38.5816, -121.4944),
    ('US', 'California',   'San Jose',         'America/Los_Angeles',  37.3382, -121.8863),
    ('US', 'Nevada',       'Las Vegas',        'America/Los_Angeles',  36.1699, -115.1398),
    ('US', 'Nevada',       'Reno',             'America/Los_Angeles',  39.5296, -119.8138),
    ('US', 'Washington',   'Seattle',          'America/Los_Angeles',  47.6062, -122.3321),
    ('US', 'Washington',   'Spokane',          'America/Los_Angeles',  47.6588, -117.4260),
    ('US', 'Oregon',       'Portland',         'America/Los_Angeles',  45.5152, -122.6784)
)
INSERT INTO cities (id, country_code, region, name, timezone, location, version)
SELECT
  gen_random_uuid(),
  s.country_code,
  s.region,
  s.name,
  s.timezone,
  ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
  1
FROM seed s
WHERE NOT EXISTS (
  SELECT 1 FROM cities c
  WHERE c.country_code = s.country_code
    AND coalesce(c.region, '') = coalesce(s.region, '')
    AND lower(c.name) = lower(s.name)
);
