/* global jasmine */

'use strict';

var playback = require('../../main/playback'),
  delay = require('lodash/function/delay'),
  defer = require('lodash/function/defer'),
  identity = require('lodash/utility/identity'),
  defaults = require('lodash/object/defaults'),
  last = require('lodash/array/last'),
  describe = jasmine.getEnv().describe,
  beforeEach = jasmine.getEnv().beforeEach,
  afterEach = jasmine.getEnv().afterEach,
  it = jasmine.getEnv().it,
  expect = jasmine.getEnv().expect,
  ONE_HOUR = 1000 * 60 * 60,
  ONE_SECOND = 1000;

describe('Mixtube Playback', function() {

  var _stageElmt,
    _entries = Object.freeze(
      ['0KSOMA3QBU0']
        .map(function(videoId) {
          return {id: videoId, provider: 'youtube'};
        }));

  _entries = _entries.concat(Object.freeze(
      ['24156386']
        .map(function(videoId) {
          return {id: videoId, provider: 'vimeo'};
        })));

  function buildNextEntryProducer(entries) {
    return function arrayBasedNextEntryProducer(entry) {
      var idx = entries.indexOf(entry);
      if (idx === -1 || idx + 1 === entries.length) {
        return null;
      }

      return entries[idx + 1];
    };
  }

  function playbackWithDefaults(inter) {
    inter = inter || identity;

    var defaultTransitionDuration = 2000;

    var defaultConfig = {
      elementProducer: function defaultElementProducer() {
        var elmt = document.createElement('div');
        elmt.classList.add('player-wrapper');
        _stageElmt.appendChild(elmt);
        return elmt;
      },
      // special case where the entry is directly the video (easier for test)
      videoProducer: identity,
      nextEntryProducer: buildNextEntryProducer(_entries),
      transitionDuration: defaultTransitionDuration,
      comingNext: jasmine.createSpy('comingNextSpy').and.callFake(
        function defaultComingNext(currentVideo, nextVideo) {
          console.group('comingNext called');
          console.log({current: currentVideo, next: nextVideo});
          console.groupEnd();
        }),
      loadFailed: jasmine.createSpy('loadFailedSpy').and.callFake(
        function logLoadingErrorWarning(entry, error) {
          console.group('Skipped a entry because of an load error');
          console.warn({entry: entry, error: error});
          console.groupEnd();
        }),
      debug: {
        mediaDuration: (2 * defaultTransitionDuration + 2000) / 1000,
        mediaQuality: 'low'
      }
    };

    return playback(defaults({}, inter(defaultConfig), defaultConfig));
  }

  beforeEach(function() {
    _stageElmt = document.createElement('div');
    _stageElmt.classList.add('stage');
    document.body.appendChild(_stageElmt);
  });

  afterEach(function() {
    document.body.removeChild(_stageElmt);
  });


  it('plays a playlist', function(done) {

    var comingNextSpy,
      pb = playbackWithDefaults(function(defaultConfig) {
        comingNextSpy = defaultConfig.comingNext;

        return {
          stateChanged: function(prevState, state) {
            if (state === playback.States.stopped) {
              runChecks();
              done();
            }
          }
        };
      });

    pb.skip(_entries[0]);
    pb.play();

    function runChecks() {
      expect(comingNextSpy.calls.count()).toEqual(_entries.length + 1);
    }

  }, ONE_HOUR);

  it('plays the last skipped to video when skip occurred while paused', function(done) {

    var comingNextSpy,
      pb = playbackWithDefaults(function(defaultConfig) {
        comingNextSpy = defaultConfig.comingNext;

        return {
          stateChanged: function(prevState, state) {
            if (state === playback.States.stopped) {
              runChecks();
              done();
            }
          }
        };
      });

    pb.play();
    pb.skip(_entries[0]);

    delay(function() {
      pb.pause();

      delay(function() {
        pb.skip(_entries[3]);
        pb.play();

        delay(function() {
          pb.skip(last(_entries));
        }, ONE_SECOND);
      }, ONE_SECOND);
    }, ONE_SECOND);

    function runChecks() {
      expect(comingNextSpy.calls.mostRecent().args[0].id).toEqual(last(_entries).id);
    }


  }, ONE_HOUR);

  it('skips over a video that failed to load', function(done) {

    var entries = _entries.slice(0, 3);
    entries[1].id = 'brokenVideoId';

    var loadFailedSpy,
      pb = playbackWithDefaults(function(defaultConfig) {
        loadFailedSpy = defaultConfig.loadFailed;

        return {
          nextEntryProducer: buildNextEntryProducer(entries),
          stateChanged: function(prevState, state) {
            if (state === playback.States.stopped) {
              runChecks();
              done();
            }
          }
        };
      });

    pb.skip(_entries[0]);
    pb.play();

    function runChecks() {
      expect(loadFailedSpy).toHaveBeenCalled();
      expect(loadFailedSpy.calls.count()).toEqual(1);
    }

  }, ONE_HOUR);

});