'use strict';

var playersPool = require('../main/playersPool'),
  playbackSlot = require('../main/playbackSlot'),
  playerFactoryMock = require('./playerFactoryMock'),
  playersPoolMock = require('./playersPoolMock'),
  defaults = require('lodash-node/modern/objects/defaults'),
  constant = require('lodash-node/modern/utilities/constant');

function PlayerFactoryMockBuilder() {

  var loadByIdImpl =
      jasmine.createSpy('loadById')
        .and.returnValue(Promise.resolve()),
    playImpl = jasmine.createSpy('playSpy'),
    fadeInImpl = jasmine.createSpy('fadeInSpy'),
    fadeOutImpl = jasmine.createSpy('fadeOutSpy')
      .and.returnValue(Promise.resolve()),
    stopImpl = jasmine.createSpy('stopSpy');

  var builder = {
    withLoadById: function(impl) {
      loadByIdImpl = impl;
      return builder;
    },

    withPlay: function(impl) {
      playImpl = impl;
      return builder;
    },

    withFadeIn: function(impl) {
      fadeInImpl = impl;
      return builder;
    },

    withFadeOut: function(impl) {
      fadeOutImpl = impl;
      return builder;
    },

    withStop: function(impl) {
      stopImpl = impl;
      return builder;
    },

    build: function() {
      return {
        canCreatePlayer: function(provider) {
          return provider === 'mock';
        },
        newPlayer: function(provider) {
          return {
            get provider() {
              return provider;
            },
            get duration() {
              return 0;
            },
            get currentTime() {
              return 0;
            },
            loadById: loadByIdImpl,
            play: playImpl,
            stop: stopImpl,
            fadeIn: fadeInImpl,
            fadeOut: fadeOutImpl
          };
        }
      };
    }
  };

  return builder;
}

function always(promise, cb) {
  promise.then(cb, function(err) {
    cb();
    Promise.reject(err);
  })
}

describe('A player pool', function() {

  var _playerFactoryMock,
    _pool;

  beforeEach(function() {
    _playerFactoryMock = playerFactoryMock();
    _playerFactoryMock.canCreatePlayer.and.callFake(function(provider) {
      return provider === 'mock';
    });
    _playerFactoryMock.newPlayer.and.callFake(function(provider) {
      return {provider: provider};
    });
    _pool = playersPool({playerFactory: _playerFactoryMock});
  });

  afterEach(function() {
    _playerFactoryMock = _pool = null;
  });

  it('delivers a player', function() {
    expect(_pool.getPlayer('mock')).toBeDefined();
  });

  it('recycles a player when freed', function() {
    var playerFirst = _pool.getPlayer('mock');

    expect(playerFirst).toBeDefined();
    _pool.releasePlayer(playerFirst);
    expect(playerFirst).toEqual(_pool.getPlayer('mock'));
  });

  describe('triggers an error', function() {
    it('when no provider is specified', function() {
      expect(function() {
        _pool.getPlayer();
      }).toThrow();
    });

    it('when a not supported provider is specified', function() {
      expect(function() {
        _pool.getPlayer('notSupportedProvider');
      }).toThrow();
    });

    it('when a foreign player instance freed', function() {
      var poolForeign = playersPool({playerFactory: _playerFactoryMock});
      expect(function() {
        _pool.releasePlayer(poolForeign.getPlayer('mock'));
      }).toThrow();
    });
  });
});

describe('A player slot', function() {

  function playerSlotMock(config) {
    var defaultConfig = {
      entry: {mockMedia: {mediaSource: 'mock', mediaKey: 'mockId'}},
      videoFetcher: function(entry) {
        return {
          provider: entry.mockMedia.mediaSource,
          id: entry.mockMedia.mediaKey
        };
      },
      cues: {
        endingSoon: {
          time: function(duration) {
            return duration - 2000;
          }, callback: jasmine.createSpy('endingSoon')
        },
        ending: {
          time: function(duration) {
            return duration - 1000;
          }, callback: jasmine.createSpy('ending')
        }
      },
      transitionDuration: 1000
    };

    return playbackSlot(defaults({}, config, defaultConfig));
  }

  it('calls videoFetcher with the given entry when load is called', function() {

    var entryMock = {};
    var videoFetcherSpy = jasmine
      .createSpy('videoFetcherSpy')
      .and.returnValue({provider: 'mock', id: 'mockId'});

    var pool = playersPoolMock();

    var slot = playerSlotMock({
      playersPool: pool,
      entry: entryMock,
      videoFetcher: videoFetcherSpy
    });

    slot.load();

    expect(videoFetcherSpy).toHaveBeenCalledWith(entryMock);
  });

  it('returns and resolves the promise', function(done) {
    var pool = playersPoolMock();
    var loadSuccessSpy = jasmine.createSpy('loadSuccessSpy');

    var slot = playerSlotMock({playersPool: pool});

    always(slot.load().then(loadSuccessSpy), function() {
      expect(loadSuccessSpy).toHaveBeenCalled();
      done();
    });
  });

  it('starts the slot properly', function(done) {
    var playSpy, fadeInSpy;
    var pool = playersPoolMock(function(props, player) {
      playSpy = player.play;
      fadeInSpy = player.fadeIn;
      return player;
    });

    var transitionDuration = 10;
    var slot = playerSlotMock({
      playersPool: pool,
      transitionDuration: transitionDuration
    });

    slot.load().then(function() {
      var config = {audioGain: 0};
      slot.start(config);

      expect(playSpy).toHaveBeenCalledWith(config);
      expect(fadeInSpy).toHaveBeenCalledWith({duration: transitionDuration});

      slot.end();

      done();
    });
  });

  it('ends the slot properly when end is called while playing', function(done) {
    var stopSpy, fadeOutSpy,
      endingSpy = jasmine.createSpy('endingSpy'),
      endingSoonSpy = jasmine.createSpy('endingSoonSpy'),
      transitionDuration = 10;

    var pool = playersPoolMock(function(props, player) {
      fadeOutSpy = player.fadeOut;
      stopSpy = player.stop;
      return player;
    });

    var slot = playerSlotMock({
      playersPool: pool,
      transitionDuration: transitionDuration,
      cues: {
        endingSoon: {callback: endingSoonSpy, time: constant(0)},
        ending: {callback: endingSpy, time: constant(0)}
      }
    });

    slot.load().then(function() {
      slot.start();
      setTimeout(function() {
        slot.end().then(function() {

          expect(fadeOutSpy).toHaveBeenCalled();
          expect(stopSpy).toHaveBeenCalled();
          expect(endingSpy).toHaveBeenCalled();
          expect(endingSoonSpy).toHaveBeenCalled();

          done();
        });
      }, 0);
    });
  });

  describe('when a call to load is unsuccessful', function() {

    it('returns and reject the promise', function(done) {
      var loadFailSpy = jasmine.createSpy('loadFailSpy');
      var pool = playersPoolMock(function(props, player) {
        player.loadById.and.returnValue(Promise.reject());
        return player;
      });

      var slot = playerSlotMock({playersPool: pool});

      always(slot.load().then(null, loadFailSpy), function() {
        expect(loadFailSpy).toHaveBeenCalled();
        done();
      });
    });

    it('ends the slot properly', function(done) {
      var endingSoonSpy = jasmine.createSpy('endingSoonSpy'),
        endingSpy = jasmine.createSpy('endingSpy');

      var pool = playersPoolMock(function(props, player) {
        player.loadById.and.returnValue(Promise.reject());
        return player;
      });

      var slot = playerSlotMock({
        playersPool: pool,
        cues: {
          endingSoon: {callback: endingSoonSpy},
          ending: {callback: endingSpy}
        }
      });

      always(slot.load(), function() {
        expect(pool.releasePlayer).toHaveBeenCalled();
        expect(endingSoonSpy).not.toHaveBeenCalled();
        expect(endingSpy).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('triggers an error when start is called before load', function() {

    var slot = playerSlotMock();

    expect(function() {
      slot.start();
    }).toThrow();
  });


  it('runs "ending soon" and "ending" in schedule', function(done) {
    var fadeOutSpy,
      endingSpy = jasmine.createSpy('endingSpy'),
      endingSoonSpy = jasmine.createSpy('endingSoonSpy'),
      videoDuration = 20000,
      cuesHandlerInterval = 100,
      playerProps;

    var pool = playersPoolMock(function(props, player) {
      playerProps = props;
      fadeOutSpy = player.fadeOut.and.callFake(function(config) {
        return new Promise(function(success) {
          setTimeout(success, config.duration);
        });
      });
      return player;
    });

    var slot = playerSlotMock({
      playersPool: pool,
      transitionDuration: videoDuration / 4,
      cues: {
        endingSoon: {
          time: function(duration) {
            return duration * 2 / 4;
          }, callback: endingSoonSpy
        },
        ending: {
          time: function(duration) {
            return duration * 3 / 4;
          }, callback: endingSpy
        }
      }
    });

    jasmine.clock().install();

    slot.load().then(function() {

      playerProps.duration = videoDuration / 1000;

      slot.start();

      // we are going to execute 3 "cues handler" cycles each time with a different currentTime value

      playerProps.currentTime = playerProps.duration * 1 / 4;
      jasmine.clock().tick(cuesHandlerInterval);
      expect(endingSoonSpy).not.toHaveBeenCalled();
      expect(endingSpy).not.toHaveBeenCalled();

      playerProps.currentTime = playerProps.duration * 2.1 / 4;
      jasmine.clock().tick(cuesHandlerInterval);
      expect(endingSoonSpy).toHaveBeenCalled();
      expect(endingSpy).not.toHaveBeenCalled();

      playerProps.currentTime = playerProps.duration * 3.1 / 4;
      jasmine.clock().tick(cuesHandlerInterval);
      expect(endingSpy).toHaveBeenCalled();

      jasmine.clock().uninstall();

      done();
    });
  })

});