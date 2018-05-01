// Copyright 2018 The Immersive Web Community Group
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import {RenderView} from '../core/renderer.js';
import {BoundsRenderer} from '../nodes/bounds-renderer.js';
import {InputRenderer} from '../nodes/input-renderer.js';
import {StatsViewer} from '../nodes/stats-viewer.js';
import {Node} from '../core/node.js';

export class WebXRView extends RenderView {
  constructor(view, pose, layer) {
    super(
      view ? view.projectionMatrix : null,
      (pose && view) ? pose.getViewMatrix(view) : null,
      (layer && view) ? layer.getViewport(view) : null,
      view ? view.eye : 'left'
    );
  }
}

export class Scene extends Node {
  constructor() {
    super();

    this._timestamp = -1;
    this._frameDelta = 0;
    this._statsStanding = false;
    this._stats = null;
    this._statsEnabled = false;
    this.enableStats(true); // Ensure the stats are added correctly by default.
    this._stageBounds = null;
    this._boundsRenderer = null;

    this._inputRenderer = null;
    this._resetInputEndFrame = true;

    this._lastTimestamp = 0;

    this._hoverFrame = 0;
    this._hoveredNodes = [];
  }

  setRenderer(renderer) {
    // Set up a non-black clear color so that we can see if something renders
    // wrong.
    renderer.gl.clearColor(0.1, 0.2, 0.3, 1.0);
    this._setRenderer(renderer);
  }

  loseRenderer() {
    if (this._renderer) {
      this._stats = null;
      this._renderer = null;
      this._inputRenderer = null;
    }
  }

  get inputRenderer() {
    if (!this._inputRenderer) {
      this._inputRenderer = new InputRenderer();
      this.addNode(this._inputRenderer);
    }
    return this._inputRenderer;
  }

  // Helper function that automatically adds the appropriate visual elements for
  // all input sources.
  updateInputSources(frame, frameOfRef) {
    // FIXME: Check for the existence of the API first. This check should be
    // removed once the input API is part of the official spec.
    if (!frame.session.getInputSources) {
      return;
    }

    let inputSources = frame.session.getInputSources();

    let newHoveredNodes = [];
    let lastHoverFrame = this._hoverFrame;
    this._hoverFrame++;

    for (let inputSource of inputSources) {
      let inputPose = frame.getInputPose(inputSource, frameOfRef);

      if (!inputPose) {
        continue;
      }

      // Any time that we have a grip matrix, we'll render a controller.
      if (inputPose.gripMatrix) {
        this.inputRenderer.addController(inputPose.gripMatrix);
      }

      if (inputPose.pointerMatrix) {
        if (inputSource.pointerOrigin == 'hand') {
          // If we have a pointer matrix and the pointer origin is the users
          // hand (as opposed to their head or the screen) use it to render
          // a ray coming out of the input device to indicate the pointer
          // direction.
          this.inputRenderer.addLaserPointer(inputPose.pointerMatrix);
        }

        // If we have a pointer matrix we can also use it to render a cursor
        // for both handheld and gaze-based input sources.

        // Check and see if the pointer is pointing at any selectable objects.
        let hitResult = this.hitTest(inputPose.pointerMatrix);

        if (hitResult) {
          // Render a cursor at the intersection point.
          this.inputRenderer.addCursor(hitResult.intersection);

          if (hitResult.node._hoverFrameId != lastHoverFrame) {
            hitResult.node.onHoverStart();
          }
          hitResult.node._hoverFrameId = this._hoverFrame;
          newHoveredNodes.push(hitResult.node);
        } else {
          // Statically render the cursor 1 meters down the ray since we didn't
          // hit anything selectable.
          let cursorPos = vec3.fromValues(0, 0, -1.0);
          vec3.transformMat4(cursorPos, cursorPos, inputPose.pointerMatrix);
          this.inputRenderer.addCursor(cursorPos);
        }
      }
    }

    for (let hoverNode of this._hoveredNodes) {
      if (hoverNode._hoverFrameId != this._hoverFrame) {
        hoverNode.onHoverEnd();
      }
    }

    this._hoveredNodes = newHoveredNodes;
  }

  handleSelect(inputSource, frame, frameOfRef) {
    let inputPose = frame.getInputPose(inputSource, frameOfRef);

    if (!inputPose) {
      return;
    }

    this.handleSelectPointer(inputPose.pointerMatrix);
  }

  handleSelectPointer(pointerMatrix) {
    if (pointerMatrix) {
      // Check and see if the pointer is pointing at any selectable objects.
      let hitResult = this.hitTest(pointerMatrix);

      if (hitResult) {
        // Render a cursor at the intersection point.
        hitResult.node.handleSelect();
      }
    }
  }

  enableStats(enable) {
    if (enable == this._statsEnabled) {
      return;
    }

    this._statsEnabled = enable;

    if (enable) {
      this._stats = new StatsViewer();
      this._stats.selectable = true;
      this.addNode(this._stats);

      if (this._statsStanding) {
        this._stats.translation = [0, 1.4, -0.75];
      } else {
        this._stats.translation = [0, -0.3, -0.5];
      }
      this._stats.scale = [0.3, 0.3, 0.3];
      quat.fromEuler(this._stats.rotation, -45.0, 0.0, 0.0);
    } else if (!enable) {
      if (this._stats) {
        this.removeNode(this._stats);
        this._stats = null;
      }
    }
  }

  standingStats(enable) {
    this._statsStanding = enable;
    if (this._stats) {
      if (this._statsStanding) {
        this._stats.translation = [0, 1.4, -0.75];
      } else {
        this._stats.translation = [0, -0.3, -0.5];
      }
      this._stats.scale = [0.3, 0.3, 0.3];
      quat.fromEuler(this._stats.rotation, -45.0, 0.0, 0.0);
    }
  }

  setBounds(stageBounds) {
    this._stageBounds = stageBounds;
    if (stageBounds && !this._boundsRenderer) {
      this._boundsRenderer = new BoundsRenderer();
      this.addNode(this._boundsRenderer);
    }
    if (this._boundsRenderer) {
      this._boundsRenderer.stageBounds = stageBounds;
    }
  }

  draw(projectionMatrix, viewMatrix, eye) {
    let view = new RenderView();
    view.projectionMatrix = projectionMatrix;
    view.viewMatrix = viewMatrix;
    if (eye) {
      view.eye = eye;
    }

    this.drawViewArray([view]);
  }

  /** Draws the scene into the base layer of the XRFrame's session */
  drawXRFrame(xrFrame, pose) {
    if (!this._renderer || !pose) {
      return;
    }

    let gl = this._renderer.gl;
    let session = xrFrame.session;
    // Assumed to be a XRWebGLLayer for now.
    let layer = session.baseLayer;

    if (!gl) {
      return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    let views = [];
    for (let view of xrFrame.views) {
      views.push(new WebXRView(view, pose, layer));
    }

    this.drawViewArray(views);
  }

  drawViewArray(views) {
    // Don't draw when we don't have a valid context
    if (!this._renderer) {
      return;
    }

    this._renderer.drawViews(views, this);
  }

  startFrame() {
    let prevTimestamp = this._timestamp;
    this._timestamp = performance.now();
    if (this._stats) {
      this._stats.begin();
    }

    if (prevTimestamp >= 0) {
      this._frameDelta = this._timestamp - prevTimestamp;
    } else {
      this._frameDelta = 0;
    }

    this._update(this._timestamp, this._frameDelta);

    return this._frameDelta;
  }

  endFrame() {
    if (this._inputRenderer && this._resetInputEndFrame) {
      this._inputRenderer.reset();
    }

    if (this._stats) {
      this._stats.end();
    }
  }

  // Override to load scene resources on construction or context restore.
  onLoadScene(renderer) {
    return Promise.resolve();
  }
}
