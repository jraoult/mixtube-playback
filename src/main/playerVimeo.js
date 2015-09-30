'use strict';

var animationGroup = require('./animationGroup'),
  animationFade = require('./animationFade'),
  isNumber = require('lodash/lang/isNumber'),
  playerAdapterVimeo = require('./nativePlayerAdapterVimeo');

/**
 * Creates a PlayerVimeo instance.
 *
 * @param {{elementProducer: function(): Element, debug: {duration: number, quality: string}}} config
 * @returns {PlayerVimeo}
 */
function playerVimeo(config) {

  var _config = config,
    _audioGain = null,
    _fadeAnimationGroup = null,
    _playerAdapter = null;

  function mute() {
    _playerAdapter.iFrame.style.opacity = 0;
    _playerAdapter.volume = 0;
  }

  function fade(fadeIn, duration) {

    var iFrameStyle = _playerAdapter.iFrame.style,
      volumeMax = _audioGain * 100,
      opacityFrom = fadeIn ? 0 : 1,
      volumeFrom = fadeIn ? 0 : volumeMax;

    if (_fadeAnimationGroup) {
      // a fade animation was in progress so we stop it to start a new one
      _fadeAnimationGroup.stop();
      // parse to float to avoid problems in Shifty
      opacityFrom = parseFloat(iFrameStyle.opacity);
      volumeFrom = _playerAdapter.volume;
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
        }),
        volume: animationFade({
          schedule: 'sound',
          duration: duration,
          from: volumeFrom,
          to: fadeIn ? volumeMax : 0,
          step: function(value) {
            _playerAdapter.volume = value;
          }
        })
      }
    });

    return _fadeAnimationGroup.start()
      // we rely only on volume animation for its scheduling stability
      // whereas the opacity uses rAF which is throttled
      .volume.then(function() {
        if (!fadeIn) {
          // It is very important specially for the opacity since the scheduling functions are different and the
          // audio animation can end then stop the whole animation group while the UI animation is throttled.
          // In this case we want to make sure the player is totally "muted" at the end.
          mute();
        }

        // clear animation reference when done
        _fadeAnimationGroup = null;
      });
  }


  function loadById(id) {
    if (!_playerAdapter) {
      _playerAdapter = playerAdapterVimeo({elementProducer: _config.elementProducer});
    }

    return _playerAdapter.loadVideoById(id);
  }

  /**
   * @param {{audioGain: number}} config
   */
  function play(config) {
    if (!config) {
      throw new TypeError('A configuration object is expected but found ' + config);
    }
    _audioGain = isNumber(config.audioGain) ? config.audioGain : 1;
    _playerAdapter.playVideo();
  }

  function pause() {
    if (_fadeAnimationGroup) {
      _fadeAnimationGroup.pause();
    }
    _playerAdapter.pauseVideo();
  }

  function resume() {
    _playerAdapter.playVideo();
    if (_fadeAnimationGroup) {
      _fadeAnimationGroup.resume();
    }
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

  function stop() {
    _playerAdapter.stopVideo();
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
      return _playerAdapter.currentTime;
    },
    get duration() {
      return _playerAdapter.duration;
    },
    loadById: loadById,
    play: play,
    pause: pause,
    resume: resume,
    stop: stop,
    fadeIn: fadeIn,
    fadeOut: fadeOut
  };

  return Object.freeze(PlayerVimeo);

}

module.exports = playerVimeo;