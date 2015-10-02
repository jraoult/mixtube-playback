'use strict';

var nativePlayerAdapterYoutube = require('./nativePlayerAdapterYoutube'),
  nativePlayerAdapterVimeo = require('./nativePlayerAdapterVimeo'),
  player = require('./player'),
  has = require('lodash/object/has');

/**
 * @typedef {Object} Player
 * @property {function(string)} loadById
 * @property {function({audioGain: number})} play
 * @property {function({duration: number})} fadeIn
 * @property {function({duration: number}):Promise} fadeOut
 * @property {function} stop
 */

/**
 * @typedef {Object} playerFactoryDebug
 * @property {number} duration the forced duration of the medias in seconds
 * @property {string} quality the forced quality for the medias (supported values: low, default)
 */

/**
 * @typedef {Object} playerFactoryConfig
 * @property {function():Element} elementProducer
 * @property {playerFactoryDebug} debug
 */

/**
 * @param {playerFactoryConfig} config
 * @returns {PlayerFactory}
 */
function playerFactory(config) {

  /** @type {playerFactoryConfig} */
  var _config = config,
    _adapterFactories = {
      youtube: nativePlayerAdapterYoutube,
      vimeo: nativePlayerAdapterVimeo
    };

  function canCreatePlayer(provider) {
    return has(_adapterFactories, provider);
  }

  /**
   * @param {string} provider
   * @returns {Player}
   */
  function newPlayer(provider) {
    if (!canCreatePlayer(provider)) {
      throw new Error('Unsupported provider type ' + provider);
    }

    var adapter = _adapterFactories[provider]({
      elementProducer: _config.elementProducer,
      debug: {
        duration: _config.debug.quality
      }
    });

    return player({
      nativePlayerAdapter: adapter,
      provider: provider,
      debug: {
        duration: _config.debug.duration
      }
    });
  }

  /**
   * @typedef PlayerFactory
   * @name PlayerFactory
   */
  var PlayerFactory = {
    canCreatePlayer: canCreatePlayer,
    newPlayer: newPlayer
  };

  return Object.freeze(PlayerFactory);
}

module.exports = playerFactory;