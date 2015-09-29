'use strict';

var animationGroup = require('./animationGroup'),
  animationFade = require('./animationFade'),
  EventEmitter = require('events').EventEmitter;

var VIMEO_ORIGIN_REGEXP = /^https?:\/\/player.vimeo.com/;

function noop() {
}

function createElement(html) {
  var div = document.createElement('div');
  div.innerHTML = html;
  return div.childNodes[0];
}

/**
 * Creates a PlayerVimeo instance.
 *
 * @param {{elementProducer: function(): Element, debug: {duration: number, quality: string}}} config
 * @returns {PlayerVimeo}
 */
function playerVimeo(config) {

  var _config = config,
    _fadeAnimationGroup = null;

  function buildIFrame() {
    var element = _config.elementProducer();
    if (!element) {
      throw new Error('The given "elementProducer" function did return any empty value');
    }

    // replace the given the placeholder by the iframe
    var iFrame = createElement('<iframe id="player1" src="about:blank" width="100%" height="100%" frameborder="0" ' +
      'webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>');
    element.parentNode.replaceChild(iFrame, element);
    return iFrame;
  }

  function newNativePlayerWrapper() {

    var emitter = new EventEmitter(),
      playerOrigin = '*',
      iFrame = buildIFrame(),
      currentTime,
      duration,
      volume;

    // prepares for the next fade in animation and avoids FOUC
    iFrame.style.opacity = 0;

    function postMessage(action, value) {
      var data = {
        method: action
      };

      if (value) {
        data.value = value;
      }

      iFrame.contentWindow.postMessage(data, playerOrigin);
    }

    window.addEventListener('message', function onMessageReceived(postMessageEvent) {
      // check it is coming from the right frame / origin
      if (postMessageEvent.source === iFrame.contentWindow && VIMEO_ORIGIN_REGEXP.test(postMessageEvent.origin)) {

        if (playerOrigin === '*') {
          playerOrigin = postMessageEvent.origin;
        }

        var postMessageData = JSON.parse(postMessageEvent.data);
        emitter.emit(postMessageData.event, postMessageData.data);
      }
    });

    emitter.on('ready', function onReady() {
      postMessage('addEventListener', 'pause');
      postMessage('addEventListener', 'finish');
      postMessage('addEventListener', 'playProgress');
    });

    emitter.on('playProgress', function onPlayProgress(evt) {
      currentTime = evt.seconds;
    });

    return {
      /**
       * @param {string} videoId
       * @returns {Promise} a promise when ready
       */
      loadVideoById: function(videoId) {
        iFrame.src = 'https://player.vimeo.com/video/' + videoId + '?api=1';
        duration = null;
        currentTime = 0;
        volume = 0;

        // force preloading and initialize duration info
        // when the promise is resolved we are sure that all that is done
        return new Promise(function loadPromiseExecutor(resolve) {
          emitter.once('ready', function onReady() {
            postMessage('setVolume', volume);
            postMessage('play');
            emitter.once('playProgress', function onFirstPlayProgress(evt) {
              postMessage('pause');
              duration = evt.duration;
              resolve();
            });
          });
        });
      },
      playVideo: function() {
        postMessage('play');
      },
      pauseVideo: function() {
        postMessage('pause');
      },
      setVolume: function(value) {
        volume = value;
        postMessage('setVolume', value);
      },
      getVolume: function() {
        return volume;
      },
      getCurrentTime: function() {
        return currentTime;
      },
      getDuration: function() {
        return duration;
      },
      getIframe: function() {
        return iFrame;
      }
    };
  }

  var _nativePlayerWrapper;

  function fade(fadeIn, duration) {

    var iFrameStyle = _nativePlayerWrapper.getIframe().style,
    //volumeMax = _audioGain * 100,
      opacityFrom = fadeIn ? 0 : 1;
    //volumeFrom = fadeIn ? 0 : volumeMax;

    if (_fadeAnimationGroup) {
      // a fade animation was in progress so we stop it to start a new one
      _fadeAnimationGroup.stop();
      // parse to float to avoid problems in Shifty
      opacityFrom = parseFloat(iFrameStyle.opacity);
      //volumeFrom = _ytPlayer.getVolume();
    }

    _fadeAnimationGroup = animationGroup({
      animations: {
        opacity: animationFade({
          schedule: 'ui',
          duration: duration,
          from: opacityFrom,
          to: fadeIn ? 1 : 0,
          step: function(value) {
            iFrameStyle.opacity = value;
          }
        })
        //volume: animationFade({
        //  schedule: 'sound',
        //  duration: duration,
        //  from: volumeFrom,
        //  to: fadeIn ? volumeMax : 0,
        //  step: function(value) {
        //    _ytPlayer.setVolume(value);
        //  }
        //})
      }
    });

    return _fadeAnimationGroup.start()
      // we rely only on volume animation for its scheduling stability
      // whereas the opacity uses rAF which is throttled
      .opacity.then(function() {
        if (!fadeIn) {
          // It is very important specially for the opacity since the scheduling functions are different and the
          // audio animation can end then stop the whole animation group while the UI animation is throttled.
          // In this case we want to make sure the player is totally "muted" at the end.
          //mute();
        }

        // clear animation reference when done
        _fadeAnimationGroup = null;
      });
  }


  function loadById(id) {
    if (!_nativePlayerWrapper) {
      _nativePlayerWrapper = newNativePlayerWrapper();
    }

    return _nativePlayerWrapper.loadVideoById(id);
  }

  /**
   * @param {{audioGain: number}} config
   */
  function play(config) {
    _nativePlayerWrapper.playVideo();
  }

  function pause() {
    if (_fadeAnimationGroup) {
      _fadeAnimationGroup.pause();
    }
    _nativePlayerWrapper.pauseVideo();
  }

  /**
   * @param {{duration: number}} config
   */
  function fadeIn(config) {
    fade(true, config.duration);
  }

  /**
   * @param {{duration: number}} config
   * @returns {Promise}
   */
  function fadeOut(config) {
    return fade(false, config.duration);
  }

  /**
   * @typedef PlayerVimeo
   * @name PlayerVimeo
   */
  var PlayerVimeo = {
    get provider() {
      return 'vimeo';
    },
    get currentTime() {
      return _nativePlayerWrapper.getCurrentTime();
    },
    get duration() {
      return _nativePlayerWrapper.getDuration();
    },
    loadById: loadById,
    play: play,
    pause: noop,
    resume: noop,
    stop: noop,
    fadeIn: fadeIn,
    fadeOut: fadeOut
  };

  return Object.freeze(PlayerVimeo);

}

module.exports = playerVimeo;