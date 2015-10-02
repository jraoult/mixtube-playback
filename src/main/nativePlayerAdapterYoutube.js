/* globals YT */

'use strict';

var EventEmitter = require('events').EventEmitter,
  has = require('lodash/object/has');

// only one mapping supported right now
var DEBUG_QUALITY_MAPPINGS = Object.freeze({
  low: 'small',
  default: 'default'
});

/**
 * Creates a PlayerAdapter instance for Youtube.
 *
 * To work it needs the YT Iframe JS API to be available on the global scope.
 *
 * @param {{elementProducer: function(): Element, debug: {quality: string}}} config
 * @returns {NativePlayerAdapter}
 */
function nativePlayerAdapterYoutube(config) {

  var _ytPlayerPromise = null,
    _ytPlayer = null,
    _playbackQuality = has(DEBUG_QUALITY_MAPPINGS, config.debug.quality) ?
      DEBUG_QUALITY_MAPPINGS[config.debug.quality] : 'default';

  // we have to use an external event mechanism since the YT API doesn't provide a working removeEventListener
  // see https://code.google.com/p/gdata-issues/issues/detail?id=6700
  var _emitter = new EventEmitter();

  function newYtPlayer() {
    return new Promise(function(resolve) {
      var element = config.elementProducer();
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

      ytPlayer.setVolume(0);
      ytPlayer.loadVideoById(id);
      ytPlayer.setPlaybackQuality(_playbackQuality);
    };
  }

  function load(ytPlayer, id) {
    return new Promise(newLoadPromiseExecutor(ytPlayer, id));
  }

  /**
   * @param {string} id
   * @returns {Promise} a promise when ready
   */
  function loadVideoById(id) {
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

  function playVideo() {
    _ytPlayer.playVideo();
  }

  function pauseVideo() {
    _ytPlayer.pauseVideo();
  }

  function stopVideo() {
    _ytPlayer.stopVideo();
  }

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

  return {
    loadVideoById: loadVideoById,
    playVideo: playVideo,
    pauseVideo: pauseVideo,
    stopVideo: stopVideo,
    dispose: function() {
    },
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
