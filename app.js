(function() {
  'use strict';

  var CONFIG = {
    appName: 'F1 Live',
    storageKey: 'hypernova_f1live',
    api: {
      baseUrl: 'https://api.openf1.org/v1',
      cacheDuration: 60 * 1000,
    },
    refreshInterval: 10 * 1000,
    mapRefreshInterval: 3 * 1000,
  };

  var TEAM_COLORS = {
    'Red Bull Racing': '#3671C6',
    'Ferrari': '#E80020',
    'McLaren': '#FF8000',
    'Mercedes': '#27F4D2',
    'Aston Martin': '#229971',
    'Alpine': '#FF87BC',
    'Williams': '#64C4FF',
    'RB': '#6692FF',
    'Kick Sauber': '#52E252',
    'Haas F1 Team': '#B6BABD',
  };

  var TYRE_COLORS = {
    'SOFT': '#ff3333',
    'MEDIUM': '#ffcc00',
    'HARD': '#ffffff',
    'INTERMEDIATE': '#33cc33',
    'WET': '#3399ff',
  };

  var state = {
    currentScreen: 'home',
    screenHistory: [],
    isLoading: false,
    error: null,
    autoRefresh: false,
    autoRefreshTimer: null,
    sessionKey: 'latest',
    session: null,
    drivers: {},
    positions: [],
    intervals: {},
    laps: {},
    raceControl: [],
    weatherData: null,
    selectedDriver: null,
    sessionLive: false,
    stints: {},
    pitStops: {},
    trackOutline: null,
    carLocations: {},
    mapRefreshTimer: null,
    cache: {},
  };

  var screens = {};

  function collectScreens() {
    document.querySelectorAll('.screen').forEach(function(s) {
      if (s.id) screens[s.id] = s;
    });
  }

  function navigateTo(screenId, options) {
    options = options || {};
    var addToHistory = options.addToHistory !== false;
    if (addToHistory && state.currentScreen) {
      state.screenHistory.push(state.currentScreen);
    }
    Object.values(screens).forEach(function(s) { s.classList.add('hidden'); });
    if (screens[screenId]) {
      screens[screenId].classList.remove('hidden');
      state.currentScreen = screenId;
      onScreenEnter(screenId);
      focusFirst(screens[screenId]);
    }
  }

  function navigateBack() {
    if (state.screenHistory.length > 0) {
      navigateTo(state.screenHistory.pop(), { addToHistory: false });
    }
  }

  function setFocus(el) {
    var prev = document.querySelector('.focused');
    if (prev) prev.classList.remove('focused');
    if (el) {
      el.focus();
      el.classList.add('focused');
    }
  }

  function focusFirst(container) {
    var el = container.querySelector('.focusable:not([disabled]):not(.hidden)');
    if (el) setFocus(el);
  }

  function getZones(container) {
    var zones = [];
    var tabBar = container.querySelector('.tab-bar');
    var content = container.querySelector('.content');
    var navBar = container.querySelector('.nav-bar');
    if (tabBar) zones.push({ el: tabBar, type: 'horizontal' });
    if (content) zones.push({ el: content, type: 'vertical' });
    if (navBar) zones.push({ el: navBar, type: 'horizontal' });
    return zones;
  }

  function getZoneItems(zone) {
    return Array.from(zone.el.querySelectorAll('.focusable:not([disabled]):not(.hidden)'));
  }

  function findCurrentZone(zones, current) {
    for (var i = 0; i < zones.length; i++) {
      if (zones[i].el.contains(current)) return i;
    }
    return -1;
  }

  function moveFocus(direction) {
    var container = screens[state.currentScreen];
    if (!container) return;
    var current = document.activeElement;
    var zones = getZones(container);
    if (zones.length === 0) return;

    var zi = findCurrentZone(zones, current);
    if (zi === -1) {
      focusFirst(container);
      return;
    }

    var zone = zones[zi];
    var items = getZoneItems(zone);
    var idx = items.indexOf(current);

    if (direction === 'left' || direction === 'right') {
      if (zone.type === 'horizontal' && items.length > 1) {
        var next;
        if (direction === 'left') {
          next = idx > 0 ? idx - 1 : items.length - 1;
        } else {
          next = idx < items.length - 1 ? idx + 1 : 0;
        }
        setFocus(items[next]);
      }
      return;
    }

    if (direction === 'down') {
      if (zone.type === 'vertical') {
        if (idx < items.length - 1) {
          setFocus(items[idx + 1]);
          items[idx + 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (zi < zones.length - 1) {
          var nextItems = getZoneItems(zones[zi + 1]);
          if (nextItems.length > 0) setFocus(nextItems[0]);
        }
      } else {
        if (zi < zones.length - 1) {
          var belowItems = getZoneItems(zones[zi + 1]);
          if (belowItems.length > 0) setFocus(belowItems[0]);
        }
      }
      return;
    }

    if (direction === 'up') {
      if (zone.type === 'vertical') {
        if (idx > 0) {
          setFocus(items[idx - 1]);
          items[idx - 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (zi > 0) {
          var aboveItems = getZoneItems(zones[zi - 1]);
          if (aboveItems.length > 0) {
            var activeTab = zones[zi - 1].el.querySelector('.active.focusable');
            setFocus(activeTab || aboveItems[0]);
          }
        }
      } else {
        if (zi > 0) {
          var prevItems = getZoneItems(zones[zi - 1]);
          if (prevItems.length > 0) setFocus(prevItems[prevItems.length - 1]);
        }
      }
    }
  }

  // ==================== API ====================

  function apiGet(endpoint, params, retries) {
    if (retries === undefined) retries = 2;
    var url = CONFIG.api.baseUrl + endpoint;
    if (params) {
      var qs = Object.keys(params).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      url += '?' + qs;
    }
    var cacheKey = url;
    if (state.cache[cacheKey] && Date.now() - state.cache[cacheKey].ts < CONFIG.api.cacheDuration) {
      return Promise.resolve(state.cache[cacheKey].data);
    }
    return fetch(url)
      .then(function(res) {
        if (res.status === 429) {
          if (retries > 0) {
            var wait = parseInt(res.headers.get('retry-after') || '3', 10) * 1000;
            return new Promise(function(resolve) { setTimeout(resolve, wait); })
              .then(function() { return apiGet(endpoint, params, retries - 1); });
          }
          throw new Error('Rate limited (429) — try again shortly');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        state.cache[cacheKey] = { data: data, ts: Date.now() };
        return data;
      });
  }

  // ==================== DATA LOADING ====================

  function getSessionStatus(session) {
    if (!session) return { live: false, label: '' };
    var now = Date.now();
    var start = session.date_start ? new Date(session.date_start).getTime() : 0;
    var end = session.date_end ? new Date(session.date_end).getTime() : 0;
    if (start && end && now >= start && now <= end) {
      return { live: true, label: 'LIVE' };
    }
    if (end && now > end) {
      var ago = now - end;
      var mins = Math.floor(ago / 60000);
      var hours = Math.floor(mins / 60);
      var days = Math.floor(hours / 24);
      var label;
      if (mins < 60) label = 'Ended ' + mins + 'm ago';
      else if (hours < 24) label = 'Ended ' + hours + 'h ago';
      else label = 'Ended ' + days + 'd ago';
      return { live: false, label: label };
    }
    if (start && now < start) {
      var until = start - now;
      var minsUntil = Math.floor(until / 60000);
      var hoursUntil = Math.floor(minsUntil / 60);
      var daysUntil = Math.floor(hoursUntil / 24);
      var ulabel;
      if (minsUntil < 60) ulabel = 'Starts in ' + minsUntil + 'm';
      else if (hoursUntil < 24) ulabel = 'Starts in ' + hoursUntil + 'h';
      else ulabel = 'Starts in ' + daysUntil + 'd';
      return { live: false, label: ulabel };
    }
    return { live: false, label: '' };
  }

  function updateSessionHeader() {
    var el = document.getElementById('session-name');
    var statusEl = document.getElementById('status-indicator');
    if (!state.session) return;

    var name = state.session.session_name || state.session.session_type || '';
    var loc = state.session.location || state.session.circuit_short_name || '';
    if (el) el.textContent = loc + (name ? ' - ' + name : '');

    var status = getSessionStatus(state.session);
    state.sessionLive = status.live;
    if (statusEl) {
      if (status.live) {
        statusEl.innerHTML = '<span class="status-live"></span>LIVE';
        statusEl.style.color = '#e10600';
        statusEl.style.fontWeight = '700';
      } else {
        statusEl.textContent = status.label;
        statusEl.style.color = '';
        statusEl.style.fontWeight = '';
      }
    }
  }

  function loadSession() {
    return apiGet('/sessions', { session_key: state.sessionKey })
      .then(function(data) {
        if (data && data.length > 0) {
          state.session = data[data.length - 1];
          updateSessionHeader();
        }
        return state.session;
      });
  }

  function loadDrivers() {
    return apiGet('/drivers', { session_key: state.sessionKey })
      .then(function(data) {
        state.drivers = {};
        if (data) {
          data.forEach(function(d) {
            state.drivers[d.driver_number] = d;
          });
        }
      });
  }

  function loadPositions() {
    return apiGet('/position', { session_key: state.sessionKey })
      .then(function(data) {
        if (!data || data.length === 0) return;
        var latest = {};
        data.forEach(function(p) {
          latest[p.driver_number] = p;
        });
        state.positions = Object.values(latest).sort(function(a, b) {
          return a.position - b.position;
        });
      });
  }

  function loadIntervals() {
    return apiGet('/intervals', { session_key: state.sessionKey })
      .then(function(data) {
        state.intervals = {};
        if (!data) return;
        data.forEach(function(iv) {
          state.intervals[iv.driver_number] = iv;
        });
      })
      .catch(function(err) {
        // Race-only endpoint: 404 expected during Quali/Practice. Treat as empty.
        if (err && err.message && err.message.indexOf('404') >= 0) {
          state.intervals = {};
          return;
        }
        throw err;
      });
  }

  function loadRaceControl() {
    return apiGet('/race_control', { session_key: state.sessionKey })
      .then(function(data) {
        state.raceControl = data || [];
      });
  }

  function loadWeather() {
    return apiGet('/weather', { session_key: state.sessionKey })
      .then(function(data) {
        if (data && data.length > 0) {
          state.weatherData = data[data.length - 1];
        }
      });
  }

  function loadStints() {
    return apiGet('/stints', { session_key: state.sessionKey })
      .then(function(data) {
        state.stints = {};
        if (!data || data.detail) return;
        data.forEach(function(s) {
          var existing = state.stints[s.driver_number];
          if (!existing || s.stint_number > existing.stint_number) {
            state.stints[s.driver_number] = s;
          }
        });
      })
      .catch(function(err) {
        if (err && err.message && err.message.indexOf('404') >= 0) {
          state.stints = {};
          return;
        }
        throw err;
      });
  }

  function loadPitStops() {
    return apiGet('/pit', { session_key: state.sessionKey })
      .then(function(data) {
        state.pitStops = {};
        if (!data || data.detail) return;
        data.forEach(function(p) {
          if (!state.pitStops[p.driver_number]) {
            state.pitStops[p.driver_number] = [];
          }
          state.pitStops[p.driver_number].push(p);
        });
      })
      .catch(function(err) {
        if (err && err.message && err.message.indexOf('404') >= 0) {
          state.pitStops = {};
          return;
        }
        throw err;
      });
  }

  function loadTrackOutline() {
    if (state.trackOutline) return Promise.resolve();
    var firstDriver = Object.keys(state.drivers)[0];
    if (!firstDriver) return Promise.resolve();
    return apiGet('/laps', {
      session_key: state.sessionKey,
      driver_number: firstDriver,
    }).then(function(lapData) {
      if (!lapData || !lapData.length) return;
      // Find first complete timed lap. Lap 1 in Quali/Practice is an out-lap
      // from the pit garage and only covers part of the circuit.
      var lap = null;
      for (var i = 0; i < lapData.length; i++) {
        if (!lapData[i].is_pit_out_lap && lapData[i].lap_duration) {
          lap = lapData[i];
          break;
        }
      }
      if (!lap) return;
      var lapStart = lap.date_start;
      var lapEnd = new Date(new Date(lapStart).getTime() + lap.lap_duration * 1000).toISOString();
      var url = CONFIG.api.baseUrl + '/location?session_key=' +
        encodeURIComponent(state.sessionKey) +
        '&driver_number=' + firstDriver +
        '&date%3E%3D' + encodeURIComponent(lapStart) +
        '&date%3C' + encodeURIComponent(lapEnd);
      return fetch(url).then(function(r) { return r.json(); });
    }).then(function(data) {
      if (!data || data.detail || !Array.isArray(data) || data.length === 0) return;
      state.trackOutline = data.map(function(p) { return { x: p.x, y: p.y }; });
    });
  }

  function loadCarLocations() {
    var ago = new Date(Date.now() - 60000).toISOString();
    var url = CONFIG.api.baseUrl + '/location?session_key=' +
      encodeURIComponent(state.sessionKey) +
      '&date%3E%3D' + encodeURIComponent(ago);
    var cacheKey = 'car_locations_live';
    if (state.cache[cacheKey] && Date.now() - state.cache[cacheKey].ts < 2000) {
      return Promise.resolve();
    }
    return fetch(url)
      .then(function(res) {
        if (res.status === 429) return [];
        if (!res.ok) return [];
        return res.json();
      })
      .then(function(data) {
        if (!data || data.detail || !Array.isArray(data)) return;
        state.cache[cacheKey] = { ts: Date.now() };
        var latest = {};
        data.forEach(function(p) {
          var existing = latest[p.driver_number];
          if (!existing || p.date > existing.date) {
            latest[p.driver_number] = p;
          }
        });
        state.carLocations = latest;
      }).catch(function() {});
  }

  function loadDriverLaps(driverNum) {
    return apiGet('/laps', { session_key: state.sessionKey, driver_number: driverNum })
      .then(function(data) {
        state.laps[driverNum] = data || [];
      });
  }

  function loadAllData() {
    var loading = document.getElementById('leaderboard-loading');
    var errorEl = document.getElementById('leaderboard-error');
    var list = document.getElementById('leaderboard-list');
    if (loading) loading.classList.remove('hidden');
    if (errorEl) errorEl.classList.add('hidden');
    if (list) list.innerHTML = '';

    return loadSession()
      .then(function() { return loadDrivers(); })
      .then(function() { return loadPositions(); })
      .then(function() { return loadIntervals(); })
      .then(function() { return loadStints(); })
      .then(function() { return loadPitStops(); })
      .then(function() {
        if (loading) loading.classList.add('hidden');
        updateSessionHeader();
        if (state.autoRefresh && !state.sessionLive) {
          stopAutoRefresh();
          showToast('Session ended — auto-refresh stopped', 'info');
        }
        renderLeaderboard();
        var boardTab = document.getElementById('tab-board');
        if (boardTab) setFocus(boardTab);
      })
      .catch(function(err) {
        if (loading) loading.classList.add('hidden');
        if (errorEl) {
          errorEl.classList.remove('hidden');
          var msg = errorEl.querySelector('.error-message');
          if (msg) msg.textContent = 'Failed to load F1 data: ' + err.message;
        }
      });
  }

  // ==================== RENDERING ====================

  function getTeamColor(driver) {
    if (!driver) return '#666';
    var teamName = driver.team_name || '';
    return TEAM_COLORS[teamName] || '#666';
  }

  function formatGap(interval) {
    if (!interval) return '';
    var g = interval.gap_to_leader;
    if (g === 0 || g === null) return 'LEADER';
    if (typeof g === 'number') return '+' + g.toFixed(3) + 's';
    if (g) return String(g).charAt(0) === '+' ? String(g) : '+' + g;
    return '';
  }

  function formatInterval(interval) {
    if (!interval) return '';
    var v = interval.interval;
    if (v === null || v === 0) return '';
    if (typeof v === 'number') return '+' + v.toFixed(3);
    if (v) return String(v).charAt(0) === '+' ? String(v) : '+' + v;
    return '';
  }

  function getMaxLaps() {
    var max = 0;
    Object.values(state.stints).forEach(function(s) {
      if (s.lap_end > max) max = s.lap_end;
    });
    return max;
  }

  function isDriverRetired(driverNum) {
    var stint = state.stints[driverNum];
    if (!stint) return false;
    var max = getMaxLaps();
    return max > 0 && stint.lap_end < max - 2;
  }

  function renderLeaderboard() {
    var container = document.getElementById('leaderboard-list');
    if (!container) return;
    container.innerHTML = '';

    if (state.positions.length === 0) {
      container.innerHTML = '<div class="error-container"><div class="error-message">No position data available yet</div></div>';
      return;
    }

    state.positions.forEach(function(pos) {
      var driver = state.drivers[pos.driver_number] || {};
      var interval = state.intervals[pos.driver_number];
      var stint = state.stints[pos.driver_number];
      var color = getTeamColor(driver);
      var posClass = pos.position <= 3 ? ' pos-' + pos.position : '';
      var gapText = formatGap(interval);
      var intText = formatInterval(interval);
      var gapClass = gapText === 'LEADER' ? 'driver-gap leader' : 'driver-gap';

      var tyreHtml = '';
      if (stint && stint.compound) {
        var tyreColor = TYRE_COLORS[stint.compound] || '#888';
        var tyreAge = stint.tyre_age_at_start + (stint.lap_end - stint.lap_start);
        tyreHtml = '<div class="tyre-info">' +
          '<span class="tyre-dot" style="background:' + tyreColor + '"></span>' +
          '<span class="tyre-age">' + tyreAge + 'L</span>' +
        '</div>';
      }

      var statusHtml = '';
      var sessionFinished = !state.sessionLive && state.session &&
        state.session.date_end && new Date(state.session.date_end).getTime() < Date.now();
      if (isDriverRetired(pos.driver_number)) {
        // DNF shown in gap area only
      } else if (sessionFinished) {
        statusHtml = '<span class="finish-badge">&#127937;</span>';
      } else {
        var driverPits = state.pitStops[pos.driver_number];
        if (driverPits && driverPits.length > 0) {
          var lastPit = driverPits[driverPits.length - 1];
          var stintData = state.stints[pos.driver_number];
          if (stintData && lastPit.lap_number >= stintData.lap_end) {
            statusHtml = '<span class="pit-badge">PIT</span>';
          }
        }
      }

      var html = '<button class="list-item focusable" data-action="select-driver" data-driver="' + pos.driver_number + '">' +
        '<span class="pos' + posClass + '">' + pos.position + '</span>' +
        '<span class="team-stripe" style="background:' + color + '"></span>' +
        '<div class="driver-info">' +
          '<div class="driver-abbr">' + (driver.name_acronym || '#' + pos.driver_number) + '</div>' +
          '<div class="driver-team-name">' + (driver.team_name || '') + '</div>' +
        '</div>' +
        statusHtml +
        tyreHtml +
        '<div class="' + gapClass + '">' +
          (isDriverRetired(pos.driver_number) ? '<span style="color:#ff4466">DNF</span>' :
            gapText + (intText ? '<br><span style="font-size:12px;color:#888">' + intText + '</span>' : '')) +
        '</div>' +
      '</button>';
      container.insertAdjacentHTML('beforeend', html);
    });
  }

  function renderRaceControl() {
    var container = document.getElementById('rc-list');
    var loading = document.getElementById('rc-loading');
    if (!container) return;
    if (loading) loading.classList.remove('hidden');
    container.innerHTML = '';

    loadRaceControl().then(function() {
      if (loading) loading.classList.add('hidden');
      if (state.raceControl.length === 0) {
        container.innerHTML = '<div class="error-container"><div class="error-message">No race control messages</div></div>';
        return;
      }
      var msgs = state.raceControl.slice().reverse().slice(0, 30);
      msgs.forEach(function(msg) {
        var flagClass = '';
        var flag = (msg.flag || '').toLowerCase();
        if (flag.indexOf('yellow') >= 0) flagClass = 'flag-yellow';
        else if (flag.indexOf('red') >= 0) flagClass = 'flag-red';
        else if (flag.indexOf('green') >= 0) flagClass = 'flag-green';
        else if (flag.indexOf('chequer') >= 0) flagClass = 'flag-chequered';
        else if (flag.indexOf('blue') >= 0) flagClass = 'flag-blue';

        var time = '';
        if (msg.date) {
          var d = new Date(msg.date);
          time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
        if (msg.lap_number) time += ' | Lap ' + msg.lap_number;

        var html = '<div class="rc-msg focusable ' + flagClass + '" tabindex="0">' +
          '<div class="rc-msg-time">' + time + '</div>' +
          '<div class="rc-msg-text">' + (msg.message || '') + '</div>' +
          (msg.category ? '<div class="rc-msg-category">' + msg.category + '</div>' : '') +
        '</div>';
        container.insertAdjacentHTML('beforeend', html);
      });
    }).catch(function() {
      if (loading) loading.classList.add('hidden');
      container.innerHTML = '<div class="error-container"><div class="error-message">Failed to load race control</div></div>';
    });
  }

  function renderWeather() {
    var container = document.getElementById('weather-cards');
    var loading = document.getElementById('weather-loading');
    if (!container) return;
    if (loading) loading.classList.remove('hidden');
    container.innerHTML = '';

    loadWeather().then(function() {
      if (loading) loading.classList.add('hidden');
      var w = state.weatherData;
      if (!w) {
        container.innerHTML = '<div class="error-container" style="grid-column:1/-1"><div class="error-message">No weather data</div></div>';
        return;
      }
      var cards = [
        { title: 'Air Temp', value: w.air_temperature, unit: '°C' },
        { title: 'Track Temp', value: w.track_temperature, unit: '°C' },
        { title: 'Humidity', value: w.humidity, unit: '%' },
        { title: 'Wind Speed', value: w.wind_speed, unit: 'm/s' },
        { title: 'Wind Dir', value: w.wind_direction, unit: '°' },
        { title: 'Pressure', value: w.pressure, unit: 'mbar' },
        { title: 'Rainfall', value: w.rainfall, unit: 'mm' },
      ];
      cards.forEach(function(c) {
        if (c.value === undefined || c.value === null) return;
        var val = typeof c.value === 'number' ? c.value.toFixed(1) : c.value;
        var html = '<div class="card">' +
          '<div class="card-title">' + c.title + '</div>' +
          '<div class="card-value">' + val + '<span class="card-unit">' + c.unit + '</span></div>' +
        '</div>';
        container.insertAdjacentHTML('beforeend', html);
      });
    }).catch(function() {
      if (loading) loading.classList.add('hidden');
      container.innerHTML = '<div class="error-container" style="grid-column:1/-1"><div class="error-message">Failed to load weather</div></div>';
    });
  }

  function renderDriverDetail(driverNum) {
    var driver = state.drivers[driverNum] || {};
    var pos = state.positions.find(function(p) { return p.driver_number === driverNum; });
    var interval = state.intervals[driverNum];

    document.getElementById('driver-name').textContent =
      (driver.first_name || '') + ' ' + (driver.last_name || driver.name_acronym || '#' + driverNum);
    document.getElementById('driver-team').textContent = driver.team_name || '';

    var statsEl = document.getElementById('driver-stats');
    if (statsEl) {
      var color = getTeamColor(driver);
      statsEl.innerHTML =
        '<div class="card" style="border-left:4px solid ' + color + '">' +
          '<div class="card-title">Position</div>' +
          '<div class="card-value">' + (pos ? 'P' + pos.position : '--') + '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">Gap to Leader</div>' +
          '<div class="card-value" style="font-size:22px">' + formatGap(interval) + '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">Number</div>' +
          '<div class="card-value">' + driverNum + '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-title">Interval</div>' +
          '<div class="card-value" style="font-size:22px">' + (formatInterval(interval) || '--') + '</div>' +
        '</div>';
    }

    var lapsLoading = document.getElementById('laps-loading');
    var lapsList = document.getElementById('laps-list');
    if (lapsLoading) lapsLoading.classList.remove('hidden');
    if (lapsList) lapsList.innerHTML = '';

    loadDriverLaps(driverNum).then(function() {
      if (lapsLoading) lapsLoading.classList.add('hidden');
      var allLaps = state.laps[driverNum] || [];
      var displayLaps = allLaps.slice(-15).reverse();
      if (displayLaps.length === 0) {
        if (lapsList) lapsList.innerHTML = '<div class="error-container"><div class="error-message">No lap data available</div></div>';
        return;
      }

      var bestLap = Infinity;
      allLaps.forEach(function(l) {
        if (!l.is_pit_out_lap && l.lap_duration && l.lap_duration < bestLap) bestLap = l.lap_duration;
      });

      displayLaps.forEach(function(lap) {
        var timeClass = 'time-white';
        if (lap.is_pit_out_lap) timeClass = 'time-yellow';
        else if (lap.lap_duration === bestLap) timeClass = 'time-purple';

        var timeStr = lap.lap_duration ? formatLapTime(lap.lap_duration) : '--:--.---';
        var sectors = '';
        [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3].forEach(function(s, i) {
          if (s !== null && s !== undefined) {
            sectors += '<span class="sector">' + s.toFixed(1) + '</span>';
          }
        });

        var html = '<div class="lap-item focusable" tabindex="0">' +
          '<span class="lap-num">Lap ' + lap.lap_number + '</span>' +
          '<span class="lap-time ' + timeClass + '">' + timeStr + '</span>' +
          (sectors ? '<div class="lap-sectors">' + sectors + '</div>' : '') +
        '</div>';
        if (lapsList) lapsList.insertAdjacentHTML('beforeend', html);
      });
    }).catch(function() {
      if (lapsLoading) lapsLoading.classList.add('hidden');
      if (lapsList) lapsList.innerHTML = '<div class="error-container"><div class="error-message">Failed to load laps</div></div>';
    });
  }

  function formatLapTime(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = seconds - mins * 60;
    var secsStr = secs.toFixed(3);
    if (secs < 10) secsStr = '0' + secsStr;
    return mins + ':' + secsStr;
  }

  // ==================== TRACK MAP ====================

  function initMap() {
    var loading = document.getElementById('map-loading');
    var canvas = document.getElementById('track-canvas');
    var statusEl = document.getElementById('map-status');
    if (loading) loading.classList.remove('hidden');
    if (canvas) canvas.style.display = 'none';

    loadTrackOutline()
      .then(function() { return loadCarLocations(); })
      .then(function() {
        if (loading) loading.classList.add('hidden');
        if (canvas) canvas.style.display = 'block';
        if (statusEl) {
          statusEl.textContent = state.sessionLive ? 'Live 3s' : 'Historical';
        }
        renderMap();
        startMapRefresh();
      })
      .catch(function() {
        if (loading) loading.classList.add('hidden');
        if (statusEl) statusEl.textContent = 'Error loading map';
      });
  }

  function renderMap() {
    var canvas = document.getElementById('track-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!state.trackOutline || state.trackOutline.length === 0) {
      ctx.fillStyle = '#a0a0b0';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No track data available', W / 2, H / 2);
      return;
    }

    var allPoints = state.trackOutline;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    allPoints.forEach(function(p) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    var rangeX = maxX - minX || 1;
    var rangeY = maxY - minY || 1;
    var pad = 40;
    var scaleX = (W - pad * 2) / rangeX;
    var scaleY = (H - pad * 2) / rangeY;
    var scale = Math.min(scaleX, scaleY);
    var offX = (W - rangeX * scale) / 2;
    var offY = (H - rangeY * scale) / 2;

    function tx(x) { return offX + (x - minX) * scale; }
    function ty(y) { return offY + (maxY - y) * scale; }

    ctx.beginPath();
    ctx.moveTo(tx(allPoints[0].x), ty(allPoints[0].y));
    for (var i = 1; i < allPoints.length; i++) {
      ctx.lineTo(tx(allPoints[i].x), ty(allPoints[i].y));
    }
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = '#3a3a50';
    ctx.lineWidth = 4;
    ctx.stroke();

    var driverNums = Object.keys(state.carLocations);
    driverNums.forEach(function(num) {
      var loc = state.carLocations[num];
      var driver = state.drivers[num] || {};
      var color = getTeamColor(driver);
      var cx = tx(loc.x);
      var cy = ty(loc.y);

      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var label = driver.name_acronym || num;
      ctx.fillText(label, cx, cy - 14);
    });
  }

  function startMapRefresh() {
    stopMapRefresh();
    if (!state.sessionLive) return;
    if (state.currentScreen !== 'track-map') return;
    state.mapRefreshTimer = setInterval(function() {
      delete state.cache['car_locations_live'];
      loadCarLocations().then(function() { renderMap(); });
    }, CONFIG.mapRefreshInterval);
  }

  function stopMapRefresh() {
    if (state.mapRefreshTimer) {
      clearInterval(state.mapRefreshTimer);
      state.mapRefreshTimer = null;
    }
  }

  // ==================== ACTIONS ====================

  function handleAction(action, element) {
    switch (action) {
      case 'back':
        navigateBack();
        break;
      case 'refresh':
        state.cache = {};
        loadAllData();
        showToast('Refreshing...', 'info');
        break;
      case 'auto-refresh-toggle':
        toggleAutoRefresh();
        break;
      case 'tab-board':
        setActiveTab('tab-board');
        document.getElementById('home-content').style.display = '';
        break;
      case 'tab-map':
        setActiveTab('tab-map');
        navigateTo('track-map');
        break;
      case 'tab-rc':
        setActiveTab('tab-rc');
        navigateTo('race-control');
        break;
      case 'tab-weather':
        setActiveTab('tab-weather');
        navigateTo('weather');
        break;
      case 'select-driver':
        var driverNum = parseInt(element.dataset.driver);
        if (driverNum) {
          state.selectedDriver = driverNum;
          navigateTo('driver-detail');
        }
        break;
      case 'refresh-driver':
        if (state.selectedDriver) {
          state.cache = {};
          renderDriverDetail(state.selectedDriver);
          showToast('Refreshing driver data...', 'info');
        }
        break;
      default:
        break;
    }
  }

  function setActiveTab(tabId) {
    document.querySelectorAll('.tab-item').forEach(function(t) {
      t.classList.toggle('active', t.id === tabId);
    });
  }

  function toggleAutoRefresh() {
    if (!state.autoRefresh && !state.sessionLive) {
      showToast('Session not live — auto-refresh disabled', 'error');
      return;
    }
    state.autoRefresh = !state.autoRefresh;
    var btn = document.getElementById('auto-refresh-btn');
    if (state.autoRefresh) {
      btn.innerHTML = '<span class="status-live"></span>Auto: ON';
      state.autoRefreshTimer = setInterval(function() {
        state.cache = {};
        loadAllData();
      }, CONFIG.refreshInterval);
    } else {
      btn.textContent = 'Auto: OFF';
      stopAutoRefresh();
    }
  }

  function stopAutoRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
    state.autoRefresh = false;
    var btn = document.getElementById('auto-refresh-btn');
    if (btn) btn.textContent = 'Auto: OFF';
  }

  function showToast(message, type) {
    var toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.offsetHeight;
    toast.classList.add('visible');
    setTimeout(function() { toast.classList.remove('visible'); }, 2500);
  }

  // ==================== SCREEN ENTER ====================

  function onScreenEnter(screenId) {
    if (screenId === 'track-map') {
      pauseLeaderboardRefresh();
      initMap();
    } else {
      stopMapRefresh();
      resumeLeaderboardRefresh();
    }
    switch (screenId) {
      case 'home':
        loadAllData();
        break;
      case 'race-control':
        renderRaceControl();
        break;
      case 'weather':
        renderWeather();
        break;
      case 'driver-detail':
        if (state.selectedDriver) renderDriverDetail(state.selectedDriver);
        break;
    }
  }

  function pauseLeaderboardRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
  }

  function resumeLeaderboardRefresh() {
    if (state.autoRefresh && !state.autoRefreshTimer) {
      state.autoRefreshTimer = setInterval(function() {
        state.cache = {};
        loadAllData();
      }, CONFIG.refreshInterval);
    }
  }

  // ==================== EVENTS ====================

  function setupEvents() {
    document.addEventListener('click', function(e) {
      var actionEl = e.target.closest('[data-action]');
      if (actionEl) handleAction(actionEl.dataset.action, actionEl);
    });

    document.addEventListener('keydown', function(e) {
      switch (e.key) {
        case 'ArrowUp':
          moveFocus('up'); e.preventDefault(); break;
        case 'ArrowDown':
          moveFocus('down'); e.preventDefault(); break;
        case 'ArrowLeft':
          moveFocus('left'); e.preventDefault(); break;
        case 'ArrowRight':
          moveFocus('right'); e.preventDefault(); break;
        case 'Enter':
          if (document.activeElement && document.activeElement.classList.contains('focusable')) {
            document.activeElement.click();
          }
          e.preventDefault();
          break;
        case 'Escape':
          navigateBack(); e.preventDefault(); break;
      }
    });
  }

  // ==================== INIT ====================

  function init() {
    collectScreens();
    setupEvents();
    navigateTo('home', { addToHistory: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
