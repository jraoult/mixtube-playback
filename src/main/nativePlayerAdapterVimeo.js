'use strict';

var EventEmitter = require('events').EventEmitter;

var VIMEO_ORIGIN_REGEXP = /^https?:\/\/player.vimeo.com/;

function createElement(html) {
  var div = document.createElement('div');
  div.innerHTML = html;
  return div.childNodes[0];
}

function copyAttributes(source, target) {
  var length = source.attributes.length;
  for (var idx = 0; idx < length; idx++) {
    var attr = source.attributes.item(idx);
    target.setAttribute(attr.nodeName, attr.nodeValue);
  }
}

function buildIFrame(elementProducer) {
  var element = elementProducer();
  if (!element) {
    throw new Error('The given "elementProducer" function did return any empty value');
  }

  // replace the given the placeholder by the iframe
  var iFrame = createElement('<iframe id="player1" src="about:blank" width="100%" height="100%" frameborder="0" ' +
    'webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>');

  copyAttributes(element, iFrame);

  element.parentNode.replaceChild(iFrame, element);
  return iFrame;
}

/**
 * Creates a PlayerAdapter instance for Vimeo.
 *
 * @param {{elementProducer: function(): Element}} config
 * @returns {PlayerAdapter}
 */
function nativePlayerAdapterVimeo(config) {

  var _emitter = new EventEmitter(),
    _playerOrigin = '*',
    _iFrame = buildIFrame(config.elementProducer),
    _currentTime,
    _duration,
    _volume;

  // prepares for the next fade in animation and avoids FOUC
  _iFrame.style.opacity = 0;

  function postMessage(action, value) {
    var data = {
      method: action
    };

    if (value) {
      data.value = value;
    }

    _iFrame.contentWindow.postMessage(data, _playerOrigin);
  }

  function onMessageReceived(postMessageEvent) {
    // check it is coming from the right frame / origin
    if (postMessageEvent.source === _iFrame.contentWindow && VIMEO_ORIGIN_REGEXP.test(postMessageEvent.origin)) {

      if (_playerOrigin === '*') {
        _playerOrigin = postMessageEvent.origin;
      }

      var postMessageData = JSON.parse(postMessageEvent.data);
      _emitter.emit(postMessageData.event, postMessageData.data);
    }
  }

  function init() {
    window.addEventListener('message', onMessageReceived);

    _emitter.once('ready', function onReady() {
      postMessage('addEventListener', 'playProgress');
      postMessage('addEventListener', 'loadProgress');
    });

    _emitter.on('playProgress', function onPlayProgress(evt) {
      _currentTime = evt.seconds;
    });

    return function dispose() {
      window.removeEventListener('message', onMessageReceived);
    };
  }

  init();

  return {
    /**
     * @param {string} id
     * @returns {Promise} a promise when ready
     */
    loadVideoById: function(id) {
      _iFrame.src = 'https://player.vimeo.com/video/' + id + '?api=1';
      _duration = null;
      _currentTime = 0;
      _volume = 0;

      return new Promise(function loadPromiseExecutor(resolve, reject) {

        function onReady() {

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
        }

        function onError(evt) {
          reject(new Error('An error with code ' + evt.data + ' occurred while loading the YouTube video ' + id));
        }

        _emitter.once('error', onError);

        _emitter.once('ready', onReady);
      });
    },
    playVideo: function() {
      postMessage('play');
    },
    pauseVideo: function() {
      postMessage('pause');
    },
    stopVideo: function() {
      postMessage('pause');
    },

    get volume() {
      return _volume;
    },
    set volume(value) {
      _volume = value;
      postMessage('setVolume', (value / 100).toString());
    },

    get currentTime() {
      return _currentTime;
    },
    get duration() {
      return _duration;
    },
    get iFrame() {
      return _iFrame;
    }
  };
}

module.exports = nativePlayerAdapterVimeo;