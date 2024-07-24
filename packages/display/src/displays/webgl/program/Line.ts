/*
 * Copyright (C) 2019-2022 HERE Europe B.V.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 * License-Filename: LICENSE
 */

// @ts-ignore
import vertexShader from '../glsl/line_vertex.glsl';
// @ts-ignore
import fragmentShader from '../glsl/line_fragment.glsl';

import Program, {UniformMap} from './Program';
import {GLStates} from './GLStates';


class LineProgram extends Program {
    name = 'Line';

    glStates = new GLStates({
        blend: true,
        scissor: true,
        depth: true
    });

    constructor(gl: WebGLRenderingContext, devicePixelRation: number) {
        super(gl, devicePixelRation);

        this.mode = gl.TRIANGLES;
        this.vertexShaderSrc = vertexShader;
        this.fragmentShaderSrc = fragmentShader;
    }

    /**
     * @internal
     * @hidden
     *
     * Determines if the buffer is visible based on the compiled uniform data.
     *
     * @param uniforms - The compiled uniform data for the buffer.
     *
     * @returns true if the buffer is visible otherwise false.
     */
    override isBufferVisible(uniforms: UniformMap): boolean {
        return uniforms.u_strokeWidth[0] > 0;
    }

    // initGeometryBuffer(buffer: GeometryBuffer, pass: PASS, stencil: boolean, zIndex: number) {
    //     const {gl} = this;
    //     super.initGeometryBuffer(buffer, pass, stencil);
    //     // gl.disable(gl.STENCIL_TEST);
    //     // gl.disable(gl.SCISSOR_TEST);
    //
    //     if (!buffer.isFlat()) {
    //         gl.polygonOffset(0, -(1<<8) * zIndex);
    //         gl.enable(gl.POLYGON_OFFSET_FILL);
    //     }
    // }
}


export default LineProgram;
