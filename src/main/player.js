'use strict';

var animationGroup = require('./animationGroup'),
  animationFade = require('./animationFade'),
  isNumber = require('lodash/lang/isNumber');

/**
 * @typedef {Object} NativePlayerAdapter
 * @property {function(string): Promise} loadVideoById
 * @property {function} playVideo
 * @property {function} pauseVideo
 * @property {function} stopVideo
 * @property {function} dispose
 * @property {number} volume the volume value between 0 and 100
 * @property {number} currentTime the current playback position in seconds
 * @property {number} duration the duration in seconds
 * @property {HTMLElement} htmlElement
 */

/**
 * Creates a Player instance.
 *
 * @param {{nativePlayerAdapter: NativePlayerAdapter, provider: string, debug: {duration: number}}} config
 * @returns {Player}
 */
function player(config) {

  var _config = config,
    _nativePlayerAdapter = _config.nativePlayerAdapter,
    _fadeAnimationGroup = null,
    _audioGain = null;

  function mute() {
    _nativePlayerAdapter.htmlElement.style.opacity = 0;
    _nativePlayerAdapter.volume = 0;
  }

  /**
   * Starts a fade (in / out) animation on the player by altering the opacity and the audio volume.
   *
   * If a fade animation was in progress it stops it first and starts fading from the last "values" for opacity
   * and volume.
   *
   * @param {boolean} fadeIn true to fade the player in, false to fade out
   * @param {number} duration
   * @returns {Promise}
   */
  function fade(fadeIn, duration) {

    var elementStyle = _nativePlayerAdapter.htmlElement.style,
      volumeMax = _audioGain * 100,
      opacityFrom = fadeIn ? 0 : 1,
      volumeFrom = fadeIn ? 0 : volumeMax;

    if (_fadeAnimationGroup) {
      // a fade animation was in progress so we stop it to start a new one
      _fadeAnimationGroup.stop();
      // parse to float to avoid problems in Shifty
      opacityFrom = parseFloat(elementStyle.opacity);
      volumeFrom = _nativePlayerAdapter.volume;
    }

    _fadeAnimationGroup = animationGroup({
      animations: {
        opacity: animationFade({
          schedule: 'ui',
          duration: duration,
          from: opacityFrom,
          to: fadeIn ? 1 : 0,
          step: function(value) {
            elementStyle.opacity = value;
          }
        }),
        volume: animationFade({
          schedule: 'sound',
          duration: duration,
          from: volumeFrom,
          to: fadeIn ? volumeMax : 0,
          step: function(value) {
            _nativePlayerAdapter.volume = value;
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
    return _nativePlayerAdapter.loadVideoById(id);
  }

  /**
   * @param {{audioGain: number}} config
   */
  function play(config) {
    if (!config) {
      throw new TypeError('A configuration object is expected but found ' + config);
    }
    _audioGain = isNumber(config.audioGain) ? config.audioGain : 1;
    _nativePlayerAdapter.playVideo();
  }

  function pause() {
    if (_fadeAnimationGroup) {
      _fadeAnimationGroup.pause();
    }
    _nativePlayerAdapter.pauseVideo();
  }

  function resume() {
    _nativePlayerAdapter.playVideo();
    if (_fadeAnimationGroup) {
      _fadeAnimationGroup.resume();
    }
  }

  function stop() {
    _nativePlayerAdapter.stopVideo();
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
   * @typedef Player
   * @name Player
   */
  var Player = {
    get provider() {
      return _config.provider;
    },
    get currentTime() {
      return _nativePlayerAdapter.currentTime;
    },
    get duration() {
      var realDuration = _nativePlayerAdapter.duration;
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
    stop: stop,
    fadeIn: fadeIn,
    fadeOut: fadeOut
  };

  return Object.freeze(Player);
}

module.exports = player;
