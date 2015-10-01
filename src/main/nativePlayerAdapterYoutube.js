/* globals YT */

'use strict';

var isNumber = require('lodash/lang/isNumber'),
  has = require('lodash/object/has'),
  EventEmitter = require('events').EventEmitter;

var _ytApiPromise = new Promise(function ytApiPromiseExecutor(resolve, reject) {
  if (!('YT' in global)) {
    if ('onYouTubeIframeAPIReady' in global) {
      reject(new Error('There is already a registered "onYouTubeIframeAPIReady" function'));
    } else {

      var apiLoadingTo = setTimeout(function() {
        reject(new Error('The YouTube player javascript API could not be loaded in a delay of 10s'));
      }, 10000);

      global.onYouTubeIframeAPIReady = function() {
        clearTimeout(apiLoadingTo);
        resolve();
      };
    }
  } else {
    resolve();
  }
});

// only one mapping supported right now
var DEBUG_QUALITY_MAPPINGS = Object.freeze({
  low: 'small',
  default: 'default'
});

/**
 * Creates a PlayerYoutube instance.
 *
 * To work it needs the YT Iframe JS API to be available on the global scope.
 *
 * @param {{elementProducer: function(): Element, debug: {duration: number, quality: string}}} config
 * @returns {PlayerYoutube}
 */
function nativePlayerAdapterYoutube(config) {

  var _config = config,
    _ytPlayerPromise = null,
    _ytPlayer = null,
    _fadeAnimationGroup = null,
    _audioGain = null,
    _playbackQuality = 'default';

  // we have to use an external event mechanism since the YT API doesn't provide a working removeEventListener
  // see https://code.google.com/p/gdata-issues/issues/detail?id=6700
  var _emitter = new EventEmitter();

  function newYtPlayer() {
    return new Promise(function(resolve) {
      var element = _config.elementProducer();
      if (!element) {
        throw new Error('The given "elementProducer" function did return any empty value');
      }

      // prepares for the next fade in animation and avoids FOUC
      element.style.opacity = 0;

      var player = new YT.Player(
        element,
        {
          height: '100%',
          width: '100%',
          playerVars: {
            controls: 0,
            disablekb: 1,
            iv_load_policy: 3,
            modestbranding: 1,
            origin: location.hostname,
            rel: 0,
            showinfo: 0
          },
          events: {
            onReady: function() {
              resolve(player);
            },
            onStateChange: function(evt) {
              _emitter.emit('stateChange', evt);
            },
            onError: function(evt) {
              _emitter.emit('error', evt);
            }
          }
        });
    });
  }

  function newLoadPromiseExecutor(ytPlayer, id) {
    return function loadPromiseExecutor(resolve, reject) {

      function unbindLoadListeners() {
        _emitter.removeListener('stateChange', loadStateChangeListener);
        _emitter.removeListener('error', loadErrorListener);
      }

      function loadStateChangeListener(evt) {
        if (evt.data === YT.PlayerState.PLAYING) {
          unbindLoadListeners();
          ytPlayer.pauseVideo();
          resolve();
        }
      }

      function loadErrorListener(evt) {
        unbindLoadListeners();
        reject(new Error('An error with code ' + evt.data + ' occurred while loading the YouTube video ' + id));
      }

      // we wait for the player the start playing once to consider it loaded
      _emitter.on('stateChange', loadStateChangeListener);
      _emitter.on('error', loadErrorListener);

      ytPlayer.loadVideoById(id);
      ytPlayer.setPlaybackQuality(_playbackQuality);
    };
  }

  function load(ytPlayer, id) {
    return new Promise(newLoadPromiseExecutor(ytPlayer, id));
  }

  function loadById(id) {
    return _ytApiPromise
      .then(function() {
        if (!_ytPlayerPromise) {
          _ytPlayerPromise = newYtPlayer();
        }
        return _ytPlayerPromise;
      })
      .then(function(ytPlayer) {
        _ytPlayer = ytPlayer;
        return load(ytPlayer, id);
      });
  }

  /**
   * @param {{audioGain: number}} config
   */
  function play(config) {
    if (!config) {
      throw new TypeError('A configuration object is expected but found ' + config);
    }
    _audioGain = isNumber(config.audioGain) ? config.audioGain : 1;
    _ytPlayer.playVideo();
  }

  function resume() {
    if (_fadeAnimationGroup) {
      _fadeAnimationGroup.resume();
    }
  }

  function stop() {
    _ytPlayer.stopVideo();
  }

  if (has(DEBUG_QUALITY_MAPPINGS, _config.debug.quality)) {
    _playbackQuality = DEBUG_QUALITY_MAPPINGS[_config.debug.quality];
  }

  /**
   * @typedef PlayerYoutube
   * @name PlayerYoutube
   */
  var PlayerYoutube = {
    get provider() {
      return 'youtube';
    },
    get currentTime() {
      return _ytPlayer.getCurrentTime();
    },
    get duration() {
      var realDuration = _ytPlayer.getDuration();
      if (_config.debug.duration < 0) {
        return realDuration;
      } else {
        return Math.min(_config.debug.duration, realDuration);
      }
    },
    loadById: loadById,
    play: play,
    pause: pause,
    resume: resume,
    stop: stop
  };

  return {
    /**
     * @param {string} id
     * @returns {Promise} a promise when ready
     */
    loadVideoById: function(id) {
      _duration = null;
      _currentTime = 0;
      _volume = 0;

      return loadPlayerInIFrame(id)
        .then(function onPlayerIFrame() {
          return new Promise(function(resolve) {
            // initialize duration info
            _emitter.once('loadProgress', function onFirstLoadProgress(evt) {
              _duration = evt.duration;
            });

            // force preloading
            postMessage('setVolume', '0');
            postMessage('play');
            _emitter.once('playProgress', function onFirstPlayProgress() {
              postMessage('pause');
              resolve();
            });
          });
        });
    },
    playVideo: function() {
      _ytPlayer.playVideo();
    },
    pauseVideo: function() {
      _ytPlayer.pauseVideo();
    },
    stopVideo: function() {
      _ytPlayer.stopVideo();
    },

    dispose: function(){},

    get volume() {
      return _ytPlayer.getVolume();
    },
    set volume(value) {
      _ytPlayer.setVolume(value);
    },

    get currentTime() {
      return _ytPlayer.getCurrentTime();
    },
    get duration() {
      return _ytPlayer.getDuration();
    },
    get iFrame() {
      return _ytPlayer.getIframe();
    }
  };
}

module.exports = nativePlayerAdapterYoutube;
