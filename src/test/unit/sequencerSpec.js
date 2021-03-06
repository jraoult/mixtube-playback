/* globals jasmine */

'use strict';

var sequencer = require('../../main/sequencer'),
  playbackSlotMock = require('./playbackSlotMock'),
  enqueueMicrotask = require('./enqueueMicrotask'),
  describe = jasmine.getEnv().describe,
  beforeEach = jasmine.getEnv().beforeEach,
  it = jasmine.getEnv().it,
  expect = jasmine.getEnv().expect,
  defaults = require('lodash/object/defaults'),
  after = require('lodash/function/after'),
  times = require('lodash/utility/times'),
  identity = require('lodash/utility/identity'),
  last = require('lodash/array/last'),
  initial = require('lodash/array/initial'),
  contains = require('lodash/collection/contains'),
  pullAt = require('lodash/array/pullAt'),
  find = require('lodash/collection/find');


describe('A sequencer', function() {

  /**
   * @param {function(Object)=} inter
   * @returns {Sequencer}
   */
  function sequencerWithDefaults(inter) {
    inter = inter || identity;

    var defaultConfig = {
      nextEntryProducer: function(entry) {
        return null;
      },
      playbackSlotProducer: function(config) {
        var slot = playbackSlotMock({
          entry: config.entry,
          video: config.entry.video
        });
        slot.load.and.returnValue(Promise.resolve());
        slot.end.and.returnValue(Promise.resolve());
        return slot;
      },
      comingNext: jasmine.createSpy('comingNextSpy'),
      stateChanged: jasmine.createSpy('stateChangedSpy'),
      loadingChanged: jasmine.createSpy('loadingChangedSpy'),
      playingChanged: jasmine.createSpy('playingChangedSpy'),
      loadFailed: jasmine.createSpy('loadFailedSpy')
    };
    return sequencer(defaults({}, inter(defaultConfig), defaultConfig));
  }

  function buildNextEntryProducer(entries) {
    return function sequentialNextEntryProducer(entry) {
      var idx = 0;
      if (entry) {
        idx = entries.indexOf(entry) + 1;
      }
      if (idx >= entries.length) {
        return null;
      }
      return entries[idx];
    };
  }

  var _entries;

  beforeEach(function() {
    _entries = times(5, function(idx) {
      var id = 'mockEntry' + idx;
      return {
        id: id,
        video: {provider: 'mock', id: 'video-' + id}
      };
    });
  });

  it('does not call nextEntryProducer first call to play', function(done) {
    var nextEntryProducerSpy = jasmine.createSpy('nextEntryProducerSpy');
    var seq = sequencerWithDefaults(function() {
      return {
        nextEntryProducer: nextEntryProducerSpy
      };
    });

    seq.play();

    enqueueMicrotask(function() {
      expect(nextEntryProducerSpy).not.toHaveBeenCalledWith(null);

      done();
    });
  });

  it('executes the right sequence when manually skipping to an entry', function(done) {
    var nextEntryProducerSpy =
        jasmine.createSpy('nextEntryProducerSpy')
          .and.callFake(buildNextEntryProducer(_entries)),

      playbackSlotProducerSpy = jasmine.createSpy('nextEntryProducerSpy');

    var seq = sequencerWithDefaults(function(seqDefaultCfg) {
      return {
        nextEntryProducer: nextEntryProducerSpy,
        playbackSlotProducer: playbackSlotProducerSpy
          .and.callFake(function(producerCfg) {
            finishGate();
            return seqDefaultCfg.playbackSlotProducer(producerCfg);
          })
      };
    });

    var expectedSlotProducerCallsCount = 4,
      finishGate = after(expectedSlotProducerCallsCount, function() {

        expect(nextEntryProducerSpy.calls.allArgs()).toEqual([
          // asked for the next entry after the entry 1
          [_entries[0]],
          // asked for the next entry after the entry 3
          [_entries[3]]
        ]);

        var slotLoadedEntries = playbackSlotProducerSpy.calls.allArgs()
          .map(function(args) {
            return args[0].entry;
          });

        expect(slotLoadedEntries).toEqual([
          // play from pristine state
          _entries[0],
          // preload next after entry 1 playing
          _entries[1],
          // manually skipped to entry 3
          _entries[3],
          // preload next after entry 3 playing
          _entries[4]
        ]);

        enqueueMicrotask(done);
      });

    seq.skip(_entries[0]);
    seq.play();

    enqueueMicrotask(function() {
      seq.skip(_entries[3]);
    });
  });

  it('schedules the preloaded entry properly so that it gets played on automated ending', function(done) {

    // the call generated by skip plus the auto ending ones
    var expectedComingNextCallsCount = _entries.length + 1,
      finishAfter = after(expectedComingNextCallsCount, function() {
        runChecks();
        done();
      }),

      comingNextSpy,
      seq = sequencerWithDefaults(function(seqDefaultCfg) {

        comingNextSpy = seqDefaultCfg.comingNext.and.callFake(finishAfter);

        return {
          nextEntryProducer: buildNextEntryProducer(_entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);

            // fake auto ending
            slot.start.and.callFake(function() {
              enqueueMicrotask(function() {
                producerCfg.endingSoon();
                enqueueMicrotask(function() {
                  producerCfg.ending();
                });
              });
            });

            return slot;
          }
        };
      });

    seq.play();
    seq.skip(_entries[0]);

    function runChecks() {
      expect(comingNextSpy.calls.count()).toEqual(expectedComingNextCallsCount);
    }
  });

  it('keeps the correct entry to play after many consecutive skip calls', function(done) {

    var slots = [];

    var seq = sequencerWithDefaults(function(seqDefaultCfg) {
      return {
        nextEntryProducer: buildNextEntryProducer(_entries),
        playbackSlotProducer: function(producerCfg) {
          var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
          slots.push(slot);
          return slot;
        }
      };
    });

    seq.play();

    // browses the list of entry and skip until the last one
    new Promise(function(resolve) {
      (function deferredWhile(idx) {
        if (idx < _entries.length) {
          enqueueMicrotask(function() {
            seq.skip(_entries[idx]);
            deferredWhile(idx + 1);
          });
        } else {
          resolve();
        }
      })(0);
    }).then(function() {

        // all but the last slot (the one playing right now with no next entry) should have been ended

        initial(slots).forEach(function(slot) {
          expect(slot.end).toHaveBeenCalled();
        });

        expect(last(slots).end).not.toHaveBeenCalled();
        expect(last(slots).entry).toEqual(last(_entries));

        done();
      });
  });

  it('calls comingNext properly when skip is called', function(done) {
    var finishAfter = after(2, function() {
        runChecks();
        done();
      }),

      comingNextSpy,
      seq = sequencerWithDefaults(function(seqDefaultCfg) {

        comingNextSpy = seqDefaultCfg.comingNext.and.callFake(finishAfter);

        return {
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            slot.end.and.callFake(function() {
              // doubled defer to simulate how actual implementation behaves
              enqueueMicrotask(function() {
                enqueueMicrotask(function() {
                  producerCfg.ending();
                });
              });

              return Promise.resolve();
            });
            return slot;
          }
        };
      });

    seq.skip(_entries[0]);
    seq.play();

    enqueueMicrotask(function() {
      seq.skip(_entries[1]);
    });

    function runChecks() {
      expect(comingNextSpy.calls.allArgs()).toEqual([
        [null, _entries[0]],
        [_entries[0], _entries[1]]
      ]);
    }
  });

  it('pauses and resumes properly', function(done) {
    var slot,
      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        return {
          playbackSlotProducer: function(producerCfg) {
            slot = seqDefaultCfg.playbackSlotProducer(producerCfg);

            slot.load.and.callFake(function() {
              enqueueMicrotask(runChecks);
              return Promise.resolve();
            });

            return slot;
          }
        };
      });

    seq.skip(_entries[0]);

    // by default slots should be suspended until play is called
    expect(slot.suspend).toHaveBeenCalled();

    seq.play();

    function runChecks() {

      expect(slot.proceed).toHaveBeenCalled();

      done();
    }
  });

  it('it resumes properly if skip was called while paused', function(done) {
    var slots = [],
      slotsIdx = 0,
      steps = [step1, step2],
      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        return {
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);

            slots[slotsIdx] = slot;
            var step = steps[slotsIdx];

            slot.load.and.callFake(function() {
              enqueueMicrotask(step);
              return Promise.resolve();
            });

            slotsIdx++;

            return slot;
          }
        };
      });

    seq.play();
    seq.pause();
    seq.skip(_entries[0]);

    function step1() {
      seq.skip(_entries[1]);
    }

    function step2() {
      seq.play();

      enqueueMicrotask(function() {

        expect(slots[0].proceed).not.toHaveBeenCalled();
        expect(slots[1].proceed).toHaveBeenCalled();

        done();
      });
    }
  });

  it('stops properly when stop is called', function(done) {

    var slots = [],
      stateChangedSpy,

      seq = sequencerWithDefaults(function(seqDefaultCfg) {

        stateChangedSpy = seqDefaultCfg.stateChanged.and.callFake(function(prevState, newState) {
          if (newState === sequencer.States.stopped) {
            runChecks();
            done();
          }
        });

        return {
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            slots.push(slot);
            return slot;
          }
        };
      });

    seq.play();
    seq.skip(_entries[0]);

    enqueueMicrotask(function() {
      seq.skip(_entries[1]);

      enqueueMicrotask(function() {
        seq.stop();
      });
    });

    function runChecks() {
      slots.forEach(function(slot) {
        expect(slot.end).toHaveBeenCalled();
      });

      expect(stateChangedSpy).toHaveBeenCalledWith(sequencer.States.playing, sequencer.States.stopped);
    }
  });

  it('preloads the new next entry when checkNextEntry is called and the next entry was removed', function(done) {

    var entries = _entries.slice(0, 3),
      slots = [],

      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        return {
          nextEntryProducer: buildNextEntryProducer(entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            slots.push(slot);

            if (slot.entry === _entries[2]) {
              enqueueMicrotask(function() {
                runChecks();
                done();
              });
            }

            return slot;
          }
        };
      });

    seq.play();
    seq.skip(entries[0]);

    enqueueMicrotask(function() {
      // remove the next
      pullAt(entries, 1);
      seq.checkNextEntry();
    });

    function runChecks() {
      // expect
      slots.forEach(function(slot) {
        expect(slot.load).toHaveBeenCalled();
      });

      expect(slots[1].end).toHaveBeenCalled();
      expect(slots[2].end).not.toHaveBeenCalled();
    }
  });

  it('preloads the new next entry when checkNextEntry is called and the next entry was added', function(done) {

    var entries = [_entries[0]],
      slots = [],

      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        return {
          nextEntryProducer: buildNextEntryProducer(entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            slots.push(slot);

            if (slot.entry === _entries[1]) {
              enqueueMicrotask(function() {
                runChecks();
                done();
              });
            }

            return slot;
          }
        };
      });

    seq.play();
    seq.skip(entries[0]);

    enqueueMicrotask(function() {
      // add the next
      entries.push(_entries[1]);
      seq.checkNextEntry();
    });

    function runChecks() {
      var entry0Slot = find(slots, {entry: _entries[0]});
      expect(entry0Slot.load).toHaveBeenCalled();

      var entry1Slot = find(slots, {entry: _entries[1]});
      expect(entry1Slot.load).toHaveBeenCalled();
      expect(entry1Slot.end).not.toHaveBeenCalled();
    }
  });

  it('does nothing when checkNextEntry is called and the next entry has not changed', function(done) {

    var entries = _entries.slice(0, 3),
      slots = [],

      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        return {
          nextEntryProducer: buildNextEntryProducer(entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            slots.push(slot);

            if (slot.entry === _entries[1]) {
              enqueueMicrotask(function() {
                runChecks();
                done();
              });
            }

            return slot;
          }
        };
      });

    seq.play();
    seq.skip(entries[0]);

    enqueueMicrotask(function() {
      seq.checkNextEntry();
    });

    function runChecks() {
      // expect
      expect(slots[0].load).toHaveBeenCalled();
      expect(slots[1].load).toHaveBeenCalled();
      expect(slots[1].end).not.toHaveBeenCalled();
    }
  });

  it('calls the loadFailed callback when en entry failed to load', function(done) {
    var loadFailedSpy,
      loadError = new Error('mock error'),

      seq = sequencerWithDefaults(function(seqDefaultCfg) {

        loadFailedSpy = seqDefaultCfg.loadFailed;

        seqDefaultCfg.stateChanged.and.callFake(function(prevState, newState) {
          if (newState === sequencer.States.stopped) {
            runChecks();
          }
        });

        return {
          nextEntryProducer: buildNextEntryProducer(_entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            slot.load.and.returnValue(Promise.reject(loadError));
            return slot;
          }
        };
      });

    seq.play();
    seq.skip(_entries[0]);

    function runChecks() {
      _entries.forEach(function(entry, idx) {
        expect(loadFailedSpy.calls.argsFor(idx)).toEqual([entry, loadError]);
      });

      done();
    }
  });

  it('tries the next entry when a slot fails to load when skip was called', function(done) {
    var lastFailingEntryIdx = 2,
      startedSlot,
      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        return {
          nextEntryProducer: buildNextEntryProducer(_entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            // make the all slots for the entries from 0 to 2 failing on load
            if (contains(_entries.slice(0, lastFailingEntryIdx + 1), slot.entry)) {
              slot.load.and.returnValue(Promise.reject());
            } else {
              slot.start.and.callFake(function() {
                startedSlot = slot;
                enqueueMicrotask(runChecks);
              });
            }
            return slot;
          }
        };
      });

    seq.play();
    seq.skip(_entries[0]);

    function runChecks() {
      expect(startedSlot.entry).toEqual(_entries[lastFailingEntryIdx + 1]);
      done();
    }
  });

  it('tries the next entry when a slot fails to load when move (auto end) was called', function(done) {
    var lastFailingEntryIdx = 3,
      startedSlot,
      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        return {
          nextEntryProducer: buildNextEntryProducer(_entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            if (slot.entry === _entries[0]) {
              slot.start.and.callFake(function() {
                enqueueMicrotask(producerCfg.ending);
              });
            } else if (contains(_entries.slice(1, lastFailingEntryIdx + 1), slot.entry)) {
              // make the all slots for the entries from 1 to 3 failing on load
              slot.load.and.returnValue(Promise.reject());
            } else {
              slot.start.and.callFake(function() {
                startedSlot = slot;
                enqueueMicrotask(runChecks);
              });
            }
            return slot;
          }
        };
      });

    seq.play();
    seq.skip(_entries[0]);

    function runChecks() {
      expect(startedSlot.entry).toEqual(_entries[lastFailingEntryIdx + 1]);
      done();
    }
  });

  it('triggers statesChanged with the right values when calling play / pause', function(done) {
    var stateChangedSpy,

      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        var expectedStateChangedCallsCount = 2,
          runChecksAfter2 = after(expectedStateChangedCallsCount, runChecks);

        stateChangedSpy = seqDefaultCfg.stateChanged.and.callFake(runChecksAfter2);
        return seqDefaultCfg;
      });

    seq.play();
    seq.pause();

    function runChecks() {
      expect(stateChangedSpy.calls.allArgs()).toEqual([
        [sequencer.States.pristine, sequencer.States.playing],
        [sequencer.States.playing, sequencer.States.paused]
      ]);
      done();
    }
  });

  it('triggers statesChanged with "stopped" state when the last valid entry finished to play', function(done) {
    var stateChangedSpy,

      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        var expectedStateChangedCallsCount = 2,
          runChecksAfter2 = after(expectedStateChangedCallsCount, runChecks);

        stateChangedSpy = seqDefaultCfg.stateChanged;

        return {
          nextEntryProducer: buildNextEntryProducer(_entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            if (slot.entry === _entries[0]) {
              slot.start.and.callFake(function() {
                enqueueMicrotask(producerCfg.ending);
              });
            } else {
              // make all the slots for the other entries failing on load
              slot.load.and.returnValue(Promise.reject());
            }
            return slot;
          },
          stateChanged: seqDefaultCfg.stateChanged.and.callFake(runChecksAfter2)
        };
      });

    seq.play();
    seq.skip(_entries[0]);

    function runChecks() {
      expect(stateChangedSpy.calls.argsFor(1)).toEqual([sequencer.States.playing, sequencer.States.stopped]);
      done();
    }
  });

  it('calls playingChanged when en entry starts', function(done) {
    var playingChangedSpy,

      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        var expectedPlayingChangedCallsCount = 2,
          runChecksAfter = after(expectedPlayingChangedCallsCount, runChecks);

        playingChangedSpy = seqDefaultCfg.playingChanged.and.callFake(runChecksAfter);
      });

    seq.play();
    seq.skip(_entries[0]);
    enqueueMicrotask(function() {
      seq.skip(_entries[1]);
    });

    function runChecks() {
      expect(playingChangedSpy.calls.allArgs()).toEqual([
        [_entries[0]],
        [_entries[1]]
      ]);
      done();
    }
  });

  it('calls loadingChanged on skip when en entry starts, stops and fails to load', function(done) {
    var loadingChangedSpy,

      seq = sequencerWithDefaults(function(seqDefaultCfg) {
        var expectedLoadingChangedCallsCount = 6,
          finishAfter = after(expectedLoadingChangedCallsCount, function() {
            runChecks();
            done();
          });

        loadingChangedSpy = seqDefaultCfg.loadingChanged.and.callFake(finishAfter);

        return {
          nextEntryProducer: buildNextEntryProducer(_entries),
          playbackSlotProducer: function(producerCfg) {
            var slot = seqDefaultCfg.playbackSlotProducer(producerCfg);
            if (slot.entry === _entries[1]) {
              slot.load.and.returnValue(Promise.reject());
            }
            return slot;
          }
        };
      });

    seq.play();
    seq.skip(_entries[0]);
    enqueueMicrotask(function() {
      // entry 1 will fail to load and the sequencer will try entry 2
      seq.skip(_entries[1]);
    });

    function runChecks() {
      expect(loadingChangedSpy.calls.allArgs()).toEqual([
        // first skip
        [_entries[0], true],
        [_entries[0], false],
        // second skip -> fail to load
        [_entries[1], true],
        [_entries[1], false],
        // second skip retry with entry 2
        [_entries[2], true],
        [_entries[2], false]
      ]);
    }
  });

});
