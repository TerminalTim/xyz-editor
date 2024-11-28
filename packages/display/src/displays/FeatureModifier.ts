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

import BasicDisplay from './BasicDisplay';
import BasicRender from './BasicRender';
import {Tile, Feature, TileLayer, GeoJSONBBox, GeoJSONCoordinate, Style} from '@here/xyz-maps-core';

let UNDEF;

const isDependent = (qk: string, clearedQuadkeys: string[]) => {
    let qkLen = qk.length;

    for (var c = 0, cQk, sQk; c < clearedQuadkeys.length; c++) {
        sQk = qk;
        cQk = clearedQuadkeys[c];

        if (qkLen > clearedQuadkeys[c].length) {
            cQk = sQk;
            sQk = clearedQuadkeys[c];
        }

        if (cQk.search(sQk) === 0) {
            return true;
        }
    }
};

class FeatureModifier {
    private display: BasicDisplay;
    private render: BasicRender;

    constructor(display: BasicDisplay, renderer: BasicRender) {
        this.display = display;
        this.render = renderer;
    }

    forEachTile(feature: Feature, cb) {
        feature.getProvider().getCachedTiles(feature.getBBox()).forEach(cb);
    }

    remove(feature: Feature, tiles: Tile[], layer: TileLayer) {
        for (let tile of tiles) {
            this.removeFromTile(feature, tile, layer);
        }
    }

    modifyInTile(feature: Feature, tile: Tile, prevCoordinates, layer: TileLayer) {
        let dData = this.isVertexDataInitialized(tile);

        if (dData) {
            // dData.setFeatureCoordinates(feature, prevCoordinates, tile, layer);
            this.display.updateTile(tile, dData, layer, feature);
            return true;
        }
        return false;
    }

    isVertexDataInitialized(tile: Tile) {
        // const SKIP_TRACK = true;
        // return this.display.buckets.get(tile.quadkey, SKIP_TRACK);
        return this.display.getBucket(tile.quadkey);
    }

    addToTile(feature: Feature, tile: Tile, layer: TileLayer) {
        const dTile = this.isVertexDataInitialized(tile);
        if (dTile) {
            this.display.updateTile(tile, dTile, layer, feature);
        }
    }

    removeFromTile(feature: Feature, tile: Tile, layer: TileLayer) {
        let dData = this.isVertexDataInitialized(tile);

        if (dData) {
            // dData.removeFeature(feature, tile, layer);
            this.display.updateTile(tile, dData, layer, feature);
            // tile.processedData.removeFeature( feature, tile );
        }
    }

    add(feature: Feature, tiles: Tile[], layer: TileLayer) {
        for (let tile of tiles) {
            this.addToTile(feature, tile, layer);
        }
    }

    updateGeometry(
        feature: Feature,
        prevBBox: GeoJSONBBox,
        prevCoordinates: GeoJSONCoordinate | GeoJSONCoordinate[] | GeoJSONCoordinate[][] | GeoJSONCoordinate[][][],
        layer: TileLayer
    ) {
        let prov = layer.getProvider();
        let prevTiles = prov.getCachedTiles(prevBBox);
        let curTiles = prov.getCachedTiles(feature.getBBox());

        for (var t = 0, len = curTiles.length; t < len; t++) {
            let iPrev = prevTiles.indexOf(curTiles[t]);
            // new in tile
            if (iPrev === -1) {
                this.addToTile(feature, curTiles[t], layer);
            } else {
                this.modifyInTile(feature, curTiles[t], prevCoordinates, layer);
                prevTiles.splice(iPrev, 1);
            }
        }

        for (var t = 0, len = prevTiles.length; t < len; t++) {
            this.removeFromTile(feature, prevTiles[t], layer);
            this.removeFromTile(feature, prevTiles[t], layer);
        }
    }

    // only used by display.setStyleGroup...
    repaint(feature: Feature, styleGroup: Style[], layer: TileLayer) {
        let fMod = this;

        fMod.forEachTile(feature, function(tile) {
            let dData = fMod.isVertexDataInitialized(tile);

            if (dData) {
                // dData.styleFeature( feature, styles, tile, layer );
                fMod.display.updateTile(tile, dData, layer, feature);
            } else if (tile.preview) {
                // clear tile preview to make sure display creates up to date preview...
                tile.preview = UNDEF;
            }
        });
    }

    clear(layer: TileLayer, clearedQuadkeys?: string[]) {
        clearedQuadkeys = clearedQuadkeys || [];

        const display = this.display;
        const index = display.layers.indexOf(layer);

        display.buckets.forEach(function(dTile) {
            if (!clearedQuadkeys.length || isDependent(dTile.quadkey, clearedQuadkeys)) {
                dTile.clear(index);
                dTile.ready(index, false);
                dTile.cancelTasks(layer);
                dTile.luTs = null;
            }
        });

        display.update();
    }
}


export default FeatureModifier;

