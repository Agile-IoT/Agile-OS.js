/*!
 * OS.js - JavaScript Cloud/Web Desktop Platform
 *
 * Copyright (c) 2011-2016, Anders Evenrud <andersevenrud@gmail.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * @author  Anders Evenrud <andersevenrud@gmail.com>
 * @licence Simplified BSD License
 */
(function(Window, GUI, Utils, API, VFS) {
  'use strict';

  /////////////////////////////////////////////////////////////////////////////
  // DEFAULTS
  /////////////////////////////////////////////////////////////////////////////

  var MIN_WIDTH = 64;
  var MIN_HEIGHT = 64;

  var TIMEOUT_SAVE = 500;
  var TIMEOUT_RESIZE = 50;
  var TIMEOUT_SHOW_ENVELOPE = 3000;
  var TIMEOUT_HIDE_ENVELOPE = 1000;

  var DEFAULT_OPTIONS = {
    aspect: 0, // 0 = no aspect, 1 = square
    width: 100,
    height: 100,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    maxHeight: 500,
    maxWidth: 500,
    left: -1,
    right: -1,
    top: 0,
    bottom: 0,
    canvas: false,
    resizable: false,
    viewBox: false, // x y w h or 'true'
    frequency: 2 // FPS for canvas
  };

  /////////////////////////////////////////////////////////////////////////////
  // HELPERS
  /////////////////////////////////////////////////////////////////////////////

  function bindWidgetEvents(instance) {
    var timeout = null;
    var position = instance._getNormalizedPosition();
    var dimension = instance._getDimension();
    var start = {x: 0, y: 0};

    function _mouseDown(ev, pos, action) {
      ev.preventDefault();

      timeout = clearTimeout(timeout);
      start = pos;
      position = instance._getNormalizedPosition();
      dimension = instance._getDimension();

      Utils.$bind(window, 'mousemove:modifywidget', function(ev, pos) {
        var dx = pos.x - start.x;
        var dy = pos.y - start.y;
        var obj = action === 'move' ? {
          left: position.left + dx,
          top: position.top + dy
        } : {
          width: instance._options.aspect ? (dimension.width + dx) : dimension.width + dx,
          height: instance._options.aspect ? (dimension.height + dx) : dimension.height + dy
        };

        instance._onMouseMove(ev, obj, action);
      });

      Utils.$bind(window, 'mouseup:modifywidget', function(ev, pos) {
        Utils.$unbind(window, 'mousemove:modifywidget');
        Utils.$unbind(window, 'mouseup:modifywidget');

        instance._onMouseUp(ev, pos, action);
      });

      instance._windowWidth = window.innerWidth;
      instance._windowHeight = window.innerHeight;
      instance._onMouseDown(ev, pos, action);
    }

    Utils.$bind(instance._$element, 'mousedown:movewidget', function(ev, pos) {
      _mouseDown(ev, pos, 'move');
    });
    Utils.$bind(instance._$resize, 'mousedown:resizewidget', function(ev, pos) {
      ev.stopPropagation();
      _mouseDown(ev, pos, 'resize');
    });

    Utils.$bind(instance._$element, 'click:showenvelope', function(ev) {
      timeout = clearTimeout(timeout);
      instance._showEnvelope();
    });
    Utils.$bind(instance._$element, 'mouseover:showenvelope', function() {
      timeout = clearTimeout(timeout);
      timeout = setTimeout(function() {
        instance._showEnvelope();
      }, TIMEOUT_SHOW_ENVELOPE);
    });
    Utils.$bind(instance._$element, 'mouseout:hideenvelope', function(ev) {
      timeout = clearTimeout(timeout);
      timeout = setTimeout(function() {
        instance._hideEnvelope();
      }, TIMEOUT_HIDE_ENVELOPE);
    });
  }

  /////////////////////////////////////////////////////////////////////////////
  // WIDGET
  /////////////////////////////////////////////////////////////////////////////

  /**
   * A CoreWM Widget
   *
   * TODO: Behave according to orientation
   *
   * @param   {String}                          name      Widget Name
   * @param   {Object}                          options   Widget Options
   * @param   {OSjs.Helpers.SettingsFragment}   settings  SettingsFragment instance
   */
  function Widget(name, options, settings) {
    options = Utils.mergeObject(DEFAULT_OPTIONS, options || {});

    if ( options.viewBox ) {
      options.resizable = true;
      if ( options.viewBox === true ) {
        options.viewBox = '0 0 ' + options.width + ' ' + options.height;
      }
    }

    this._position = {
      left: settings.get('left', options.left),
      top: settings.get('top', options.top),
      right: settings.get('right', options.right),
      bottom: settings.get('bottom', options.bottom)
    };

    this._dimension = {
      height: settings.get('height', options.height),
      width: settings.get('width', options.width)
    };

    this._name = name;
    this._settings = settings;
    this._options = options;
    this._isManipulating = false;
    this._windowWidth = window.innerWidth;
    this._windowHeight = window.innerHeight;
    this._requestId = null;
    this._saveTimeout = null;

    this._$element = null;
    this._$resize = null;
    this._$canvas = null;
    this._$context = null

    console.debug('Widget::construct()', this._name, this._settings.get());
  }

  /**
   * When Widget is initialized
   *
   * @param {Node}      root          The DOM Node to append Widget to
   *
   * @return {Node}                   The created DOM Node containing Widget
   */
  Widget.prototype.init = function(root) {
    this._windowWidth = window.innerWidth;
    this._windowHeight = window.innerHeight;
    this._$element = document.createElement('corewm-widget');
    this._$resize = document.createElement('corewm-widget-resize');

    if ( this._options.canvas ) {
      this._$canvas = document.createElement('canvas');
      this._$canvas.width = (this._dimension.width || MIN_WIDTH);
      this._$canvas.height = (this._dimension.height || MIN_HEIGHT);

      if ( this._options.viewBox ) {
        this._$canvas.setAttribute('viewBox', this._options.viewBox);
      }

      this._$context = this._$canvas.getContext('2d');
      this._$element.appendChild(this._$canvas);
    }

    bindWidgetEvents(this);

    this._updatePosition();
    this._updateDimension();

    this._$element.appendChild(this._$resize);
    root.appendChild(this._$element);

    return this._$element;
  };

  /**
   * When widget has been rendered to DOM and added in WindowManager
   */
  Widget.prototype._inited = function() {
    var self = this;

    this.onInited();
    this.onResize(this._dimension);

    var fpsInterval, startTime, now, then, elapsed;

    function animate() {
      window.requestAnimationFrame(animate);

      now = Date.now();
      elapsed = now - then;

      if ( elapsed > fpsInterval ) {
        then = now - (elapsed % fpsInterval);
        self.onRender();
      }
    }

    if ( this._$canvas ) {
      var fps = Math.min(this._options.frequency, 1);

      this._requestId = window.requestAnimationFrame(function() {
        fpsInterval = 1000 / fps;
        then = Date.now();
        startTime = then;

        animate();
      });
    }
  };

  /**
   * When WindowManager requests destruction of Widget
   */
  Widget.prototype.destroy = function() {
    Utils.$unbind(window, 'mousemove:modifywidget');
    Utils.$unbind(window, 'mouseup:modifywidget');
    Utils.$unbind(this._$resize, 'mousedown:resizewidget');
    Utils.$unbind(this._$element, 'mousedown:movewidget');
    Utils.$unbind(this._$element, 'click:showenvelope');
    Utils.$unbind(this._$element, 'mouseover:showenvelope');
    Utils.$unbind(this._$element, 'mouseout:hideenvelope');

    this._saveTimeout = clearTimeout(this._saveTimeout);

    if ( this._requestId ) {
      window.cancelAnimationFrame(this._requestId);
    }
    this._requestId = null;

    this._$canvas = Utils.$remove(this._$canvas);
    this._$resize = Utils.$remove(this._$resize);
    this._$element = Utils.$remove(this._$element);
    this._$context = null;
  };

  /**
   * When mouse is pressed
   */
  Widget.prototype._onMouseDown = function(ev, pos, action) {
    Utils.$addClass(this._$element, 'corewm-widget-active');

    // This temporarily sets the position to a normalized one
    // to prevent resizing going in wrong direction
    if ( action === 'resize' ) {
      var obj = this._getNormalizedPosition();
      this._setPosition(obj);
    }
  };

  /**
   * When mouse is moved after pressing
   */
  Widget.prototype._onMouseMove = function(ev, obj, action) {
    var self = this;

    this._isManipulating = true;

    if ( action === 'move' ) {
      this._setPosition(obj, true);
      this.onMove(this._position);
    } else {
      this._setDimension(obj);
      this.onResize(this._dimension);
    }
  };

  /**
   * When mouse has been released
   */
  Widget.prototype._onMouseUp = function(ev, pos, action) {
    var self = this;

    this._isManipulating = false;
    this._resizeTimeout = clearTimeout(this._resizeTimeout);

    Utils.$removeClass(this._$element, 'corewm-widget-active');

    this._hideEnvelope();

    // This resets the position back to an absolute one
    // after it was temporarily set in onMouseDown
    if ( action === 'resize' ) {
      this._setPosition(null, true);
    }

    this._saveTimeout = clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(function() {
      self._saveOptions();
    }, TIMEOUT_SAVE);
  };

  /**
   * Saves this Widgets settings to CoreWM
   */
  Widget.prototype._saveOptions = function() {
    var opts = {
      width: this._dimension.width,
      height: this._dimension.height,
      left: this._position.left,
      top: this._position.top,
      right: this._position.right,
      bottom: this._position.bottom
    };

    this._settings.set(null, opts, true);
  };

  /**
   * Show the envelope containing this Widget
   */
  Widget.prototype._showEnvelope = function() {
    if ( !this._$element ) {
      return;
    }
    Utils.$addClass(this._$element, 'corewm-widget-envelope');
  };

  /**
   * Hide the envelope containing this Widget
   */
  Widget.prototype._hideEnvelope = function() {
    if ( !this._$element || this._isManipulating ) {
      return;
    }
    Utils.$removeClass(this._$element, 'corewm-widget-envelope');
  };

  /**
   * Sets the position and correctly aligns it to the DOM (sticking)
   */
  Widget.prototype._setPosition = function(obj, stick) {
    obj = obj || Utils.cloneObject(this._position);

    this._position.top = obj.top;
    this._position.left = obj.left;
    this._position.bottom = null;
    this._position.right = null;

    if ( stick ) {
      if ( this._isPastHalf('vertical', obj) ) {
        this._position.top = null;
        this._position.bottom = this._windowHeight - this._dimension.height - obj.top;
      }

      if ( this._isPastHalf('horizontal', obj) ) {
        this._position.left = null;
        this._position.right = this._windowWidth - this._dimension.width - obj.left;
      }
    }

    this._updatePosition();
  };

  /**
   * Sets the dimension of the widget
   */
  Widget.prototype._setDimension = function(obj) {
    var o = this._options;
    var w = Math.min(Math.max(obj.width, o.minWidth), o.maxWidth);
    var h = Math.min(Math.max(obj.height, o.minHeight), o.maxHeight);

    this._dimension.width = w;
    this._dimension.height = h;

    this._updateDimension();
  };

  /**
   * Updates the Widgets position based on internal options
   */
  Widget.prototype._updatePosition = function() {
    if ( this._$element ) {
      if ( this._position.right !== null ) {
        this._$element.style.left = 'auto';
        this._$element.style.right = String(this._position.right) + 'px';
      } else {
        this._$element.style.left = String(this._position.left) + 'px';
        this._$element.style.right = 'auto';
      }

      if ( this._position.bottom !== null ) {
        this._$element.style.top = 'auto';
        this._$element.style.bottom = String(this._position.bottom) + 'px';
      } else {
        this._$element.style.top = String(this._position.top) + 'px';
        this._$element.style.bottom = 'auto';
      }
    }
  };

  /**
   * Updates the Widgets dimensions based on internal options
   */
  Widget.prototype._updateDimension = function() {
    if ( this._$element ) {
      this._$element.style.width = String(this._dimension.width) + 'px';
      this._$element.style.height = String(this._dimension.height) + 'px';
    }

    if ( this._$canvas ) {
      this._$canvas.width = this._dimension.width;
      this._$canvas.height = this._dimension.height;
    }
  };

  /**
   * Gets the position of the Widget
   *
   * @return {Object}
   */
  Widget.prototype._getNormalizedPosition = function() {
    var left = this._position.left;
    if ( this._position.right ) {
      left = this._windowWidth - this._position.right - this._dimension.width;
    }

    var top = this._position.top;
    if ( this._position.bottom ) {
      top = this._windowHeight - this._position.bottom - this._dimension.height;
    }

    return {left: left, top: top};
  };

  /**
   * Gets the dimensions
   *
   * @return {Object}
   */
  Widget.prototype._getDimension = function() {
    return {
      width: this._dimension.width,
      height: this._dimension.height
    };
  };

  /**
   * Gets the position
   *
   * @return {Object}
   */
  Widget.prototype._getPosition = function() {
    return {
      left: this._position.left,
      top: this._position.top,
      right: this._position.right,
      bottom: this._position.bottom
    };
  };

  /**
   * Check if widget has passed the middle of screen in
   * given direction
   *
   * @return {Boolean}
   */
  Widget.prototype._isPastHalf = function(dir, obj) {
    obj = obj || this._position;

    var hleft = this._windowWidth / 2;
    var aleft = obj.left + (this._dimension.width / 2);
    if ( dir === 'horizontal' ) {
      return aleft >= hleft;
    }

    var htop = this._windowHeight / 2;
    var atop = obj.top + (this._dimension.height / 2);
    return atop >= htop;
  };

  /**
   * When Widget is being moved
   */
  Widget.prototype.onMove = function() {
    // Implement in your widget
  };

  /**
   * When Widget is being resized
   */
  Widget.prototype.onResize = function() {
    // Implement in your widget
  };

  /**
   * When Widget is being rendered
   */
  Widget.prototype.onRender = function() {
    // Implement in your widget
  };

  /**
   * When Widget has been initialized
   */
  Widget.prototype.onInited = function() {
    // Implement in your widget
  };

  /////////////////////////////////////////////////////////////////////////////
  // EXPORTS
  /////////////////////////////////////////////////////////////////////////////

  OSjs.Applications.CoreWM = OSjs.Applications.CoreWM || {};
  OSjs.Applications.CoreWM.Widget = Object.freeze(Widget);

})(OSjs.Core.Window, OSjs.GUI, OSjs.Utils, OSjs.API, OSjs.VFS);
