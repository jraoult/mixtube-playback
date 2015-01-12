'use strict';

var enumeration = require('./enumeration'),
  singleton = require('./singleton'),
  collection = require('./collection'),
  promiseDone = require('./promiseDone');

/**
 * @name Entry
 * @typedef {Object} Entry
 */

/**
 * @typedef {Object} SequencerStates
 * @property pristine
 * @property playing
 * @property paused
 * @property stopped
 */

/**
 * @type {SequencerStates}
 */
var States = enumeration(['pristine', 'playing', 'paused', 'stopped']);

/**
 * @name sequencerConfig
 * @typedef {Object} sequencerConfig
 * @property {function(?Entry):Entry} nextEntryProducer
 * @property {function(Video, ?Video)} comingNext
 * @property {function({entry: Entry, endingSoon: function, ending: function}):PlaybackSlot} playbackSlotProducer
 */

/**
 * @param {sequencerConfig} config
 * @return Sequencer
 */
function sequencer(config) {

  var _config = config,

    _state = singleton({
      init: States.pristine,
      changedListener: function(prevState, state) {
        if (state === States.playing) {
          forEachSlot(function(slot) {
            slot.proceed();
          });
        } else if (state === States.paused) {
          forEachSlot(function(slot) {
            slot.suspend();
          });
        }
      }
    }),

    _endingSlots = collection({
      addedListener: function(slot) {
        slot.end().then(function() {
          _endingSlots.remove(slot);
        });
      }
    }),

    _preloadingSlot = singleton({
      changedListener: function(prevSlot, slot) {
        if (prevSlot) prevSlot.end();
        if (slot) slot.load();
      }
    }),

    _skippingSlot = singleton({
      changedListener: function(prevSlot) {
        if (prevSlot) _endingSlots.add(prevSlot);
      }
    }),

    _playingSlot = singleton({
      changedListener: function(prevSlot, slot) {
        if (prevSlot) _endingSlots.add(prevSlot);

        if (slot) {
          slot.start();
          var nextEntry = _config.nextEntryProducer(slot.entry);
          if (nextEntry) {
            preload(nextEntry);
          }
        }
      }
    });

  function forEachSlot(callback) {
    [_preloadingSlot, _skippingSlot, _playingSlot]
      .forEach(function(singleton) {
        if (singleton.get()) callback(singleton.get())
      });

    _endingSlots.forEach(callback);
  }

  /**
   * @param {Entry} entry
   * @returns {PlaybackSlot}
   */
  function newPlaybackSlot(entry) {
    var slot = _config.playbackSlotProducer({
      entry: entry,
      endingSoon: notifyComingNext,
      ending: move
    });

    if (_state.get() === States.paused) slot.suspend();

    return slot;
  }

  function notifyComingNext() {
    var nextVideo = null;
    if (_skippingSlot.get()) {
      nextVideo = _skippingSlot.get().video
    } else if (_preloadingSlot.get()) {
      nextVideo = _preloadingSlot.get().video;
    }

    _config.comingNext(_playingSlot.get().video, nextVideo);
  }

  /**
   * @param {Entry} entry
   */
  function preload(entry) {
    if (!entry) {
      throw new TypeError('An entry is expected but found ' + entry);
    }

    var slot = newPlaybackSlot(entry);
    // setting the pre-loading singleton will automatically starts loading the slot
    _preloadingSlot.set(slot);
  }

  /**
   * Moves to the pre-loaded entry.
   *
   * If there is not pre-loaded slot this function does nothing
   */
  function move() {
    var slot = _preloadingSlot.get();
    if (slot) {
      promiseDone(
        slot.load().then(function() {
          if (slot === _preloadingSlot.get()) {
            _preloadingSlot.clear();
            _playingSlot.set(slot);
          }
        }));
    }
  }

  /**
   * Skips to the given entry.
   *
   * Skipping has priority over moving so that once loaded it will interrupt any playing slot to replace it.
   *
   * @param {Entry} entry
   */
  function skip(entry) {
    if (!entry) {
      throw new TypeError('An entry is expected but found ' + entry);
    }

    var slot = newPlaybackSlot(entry);
    _skippingSlot.set(slot);
    promiseDone(
      slot.load().then(function skipLoadFulfilled() {
        if (slot === _skippingSlot.get()) {
          _skippingSlot.clear();
          // preloaded slot became irrelevant because of skipping
          _preloadingSlot.set(null);
          _playingSlot.set(slot);
        }
      }));
  }

  function play() {
    _state.set(States.playing);
  }

  function pause() {
    _state.set(States.paused);
  }

  /**
   * @name Sequencer
   * @typedef Sequencer
   */
  var Sequencer = {
    play: play,
    pause: pause,
    skip: skip
  };

  return Object.freeze(Sequencer);
}

module.exports = sequencer;