/*
 * Copyright (C) 2019 HERE Europe B.V.
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
import {editorTests, displayTests, testUtils, prepare} from 'hereTest';
import {Map} from '@here/xyz-maps-core';
import {features, Editor} from '@here/xyz-maps-editor';
import chai from 'chai/chai';
import dataset from './map_destroy_spec.json';

describe('destroy editor', function() {
    const expect = chai.expect;

    let editor;
    let display;
    let preparedData;
    let mapContainer;

    before(async function() {
        preparedData = await prepare(dataset);
        display = new Map(document.getElementById('map'), {
            center: {longitude: 76.706833, latitude: 13.350071},
            zoomLevel: 18,
            layers: preparedData.getLayers()
        });
        editor = new Editor(display, {
            layers: preparedData.getLayers()
        });

        await editorTests.waitForEditorReady(editor);

        mapContainer = display.getContainer();

        editor.addFeature(new features.Navlink([{x: 100, y: 100}, {x: 200, y: 100}, {x: 200, y: 50}], {featureClass: 'NAVLINK'}));
    });

    after(async function() {
        if (editor.destroy) editor.destroy();
        display.destroy();
        await preparedData.clear();
    });

    it('validate editor is working', async function() {
        expect(editor.info()).to.have.lengthOf(1);

        expect(editor.get('history.current')).to.equal(1);
        expect(editor.get('history.length')).to.equal(1);
        expect(editor.get('changes.length')).to.equal(1);

        await testUtils.events.click(mapContainer, 200, 100);
        await testUtils.events.drag(mapContainer, {x: 200, y: 100}, {x: 250, y: 100});

        expect(display.getCenter()).to.deep.equal({longitude: 76.706833, latitude: 13.350071});
    });

    it('destroy editor and validate', async function() {
        editor.destroy();

        await testUtils.events.click(mapContainer, 100, 100);
        await displayTests.waitForViewportReady(display, async ()=>{
            await testUtils.events.drag(mapContainer, {x: 100, y: 100}, {x: 150, y: 100});
        });

        expect(display.getCenter()).to.not.deep.include({longitude: 76.706833, latitude: 13.350071});

        expect(editor).to.deep.equal({});
    });
});