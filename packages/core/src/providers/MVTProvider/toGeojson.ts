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

import {TaskManager} from '@here/xyz-maps-common';
import Protobuf from 'pbf';
import vtLib from '@mapbox/vector-tile';
import {ProcessedMvtResult} from '../../loaders/MVT/MVTLoader';

const VectorTile = vtLib.VectorTile;
const VectorTileFeature = vtLib.VectorTileFeature;
let UNDEF;

VectorTileFeature.prototype.loadGeometry = function() {
    var pbf = this._pbf;
    pbf.pos = this._geometry;

    var end = pbf.readVarint() + pbf.pos;
    var cmd = 1;
    var length = 0;
    var x = 0;
    var y = 0;
    var lines = [];
    var line;

    while (pbf.pos < end) {
        if (length <= 0) {
            var cmdLen = pbf.readVarint();
            cmd = cmdLen & 0x7;
            length = cmdLen >> 3;
        }

        length--;

        if (cmd === 1 || cmd === 2) {
            x += pbf.readSVarint();
            y += pbf.readSVarint();

            if (cmd === 1) { // moveTo
                if (line) lines.push(line);
                line = [];
            }

            line.push([x, y]);
        } else if (cmd === 7) {
            // Workaround for https://github.com/mapbox/mapnik-vector-tile/issues/90
            if (line) {
                line.push(line[0].slice()); // closePolygon
            }
        } else {
            throw new Error('unknown command ' + cmd);
        }
    }

    if (line) lines.push(line);

    return lines;
};


let taskManager = TaskManager.getInstance();

var BUNDLE_FEATURE_SIZE = 16;

var guid = 0;


interface GeoJsonFeature {
    type: 'Feature',
    id?: number | string;
    bbox?: number[];
    geometry: {
        type: string,
        coordinates: any[];
        _xyz?: any;
    }
    properties?: {[name:string]: any}
}

function classifyRings(rings) {
    var len = rings.length;

    if (len <= 1) return [rings];

    var polygons = [];
    var polygon;
    var ccw;

    for (var i = 0; i < len; i++) {
        var area = signedArea(rings[i]);
        if (area === 0) continue;

        if (ccw === undefined) ccw = area < 0;

        if (ccw === area < 0) {
            if (polygon) polygons.push(polygon);
            polygon = [rings[i]];
        } else {
            polygon.push(rings[i]);
        }
    }
    if (polygon) polygons.push(polygon);

    return polygons;
}

function signedArea(ring) {
    // return NaN;
    let sum = 0;
    for (var i = 0, len = ring.length, j = len - 1, p1, p2; i < len; j = i++) {
        p1 = ring[i];
        p2 = ring[j];
        sum += (p2[0] - p1[0]) * (p1[1] + p2[1]);
    }
    return sum;
}


const decodeGeometry = (vtFeature, x, y, z) => {
    var size = vtFeature.extent * (1 << z);
    var x0 = vtFeature.extent * x;
    var y0 = vtFeature.extent * y;
    let coords = processCoordinates(vtFeature, x, y, z, (line) => {
        for (var j = 0; j < line.length; j++) {
            var p = line[j];
            var lon = x2Lon(p[0] + x0, size);
            var lat = y2Lat(p[1] + y0, size);
            line[j] = [lon, lat];
        }
    });

    if (coords.length === 1) {
        coords = coords[0];
    }
    return coords;
};


const x2Lon = (x, size) => {
    return x * 360 / size - 180;
};

const y2Lat = (y, size) => {
    const y2 = 180 - y * 360 / size;
    return 360 / Math.PI * Math.atan(Math.exp(y2 * Math.PI / 180)) - 90;
};

const processCoordinates = (vtFeature, x, y, z, processor) => {
    let coords = vtFeature.loadGeometry();
    switch (vtFeature.type) {
    case 1:
        var points = [];
        for (let i = 0; i < coords.length; i++) {
            points[i] = coords[i][0];
        }
        coords = points;
        processor(coords, x, y, z, vtFeature);
        break;

    case 2:
        for (let i = 0; i < coords.length; i++) {
            processor(coords[i], x, y, z, vtFeature);
        }
        break;

    case 3:
        coords = classifyRings(coords);
        for (let i = 0; i < coords.length; i++) {
            for (let j = 0; j < coords[i].length; j++) {
                processor(coords[i][j], x, y, z, vtFeature);
            }
        }
        break;
    }
    return coords;
};

const decodeBBox = (vtFeature, x, y, z) => {
    let minX = Infinity;
    let maxX = -minX;
    let minY = minX;
    let maxY = -minY;
    let size = vtFeature.extent * (1 << z);
    let x0 = vtFeature.extent * x;
    let y0 = vtFeature.extent * y;
    let type = VectorTileFeature.types[vtFeature.type];

    const coords = processCoordinates(vtFeature, x, y, z, (line) => {
        for (let p of line) {
            let x = p[0];
            let y = p[1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    });

    if (coords.length > 1) {
        type = 'Multi' + type;
    }

    return {
        bbox: [x2Lon(minX + x0, size), y2Lat(maxY + y0, size), x2Lon(maxX + x0, size), y2Lat(minY + y0, size)],
        type: type
    };
};

// window.tt = 0;

function vtFeatureToGeoJSON(vtFeature, xyz, includeBBox) {
    const geom = decodeBBox(vtFeature, xyz.x, xyz.y, xyz.z);
    // const geom = decodeGeometry(vtFeature, x, y, z, includeBBox);
    const result: GeoJsonFeature = {
        type: 'Feature',
        geometry: new FeatureGeometry(geom.type, vtFeature, xyz),
        properties: vtFeature.properties
    };

    if ('id' in vtFeature) {
        result.id = vtFeature.id;
    }

    if (includeBBox) {
        result.bbox = geom.bbox;
    }

    return result;
}

const scaleToTilesize = (line, x, y, z, vtFeature) => {
    const {extent} = vtFeature;
    const worldSize = (1 << z);

    for (let p of line) {
        p[0] = (x + p[0] / extent) / worldSize;
        p[1] = (y + p[1] / extent) / worldSize;
    }
};

class FeatureGeometry {
    type: string;
    private _vtf: any;
    __xyz: { x: number, y: number, z: number };

    constructor(type: string, vtFeature, xyz) {
        this.type = type;

        this._vtf = vtFeature;

        this.__xyz = xyz;
    }

    _coordinates() {
        // console.time('t');
        const type = this.type;
        const {x, y, z} = this.__xyz;

        let coords = processCoordinates(this._vtf, x, y, z, scaleToTilesize);

        if (type == 'Point' || type == 'Polygon' || type == 'LineString') {
            coords = coords[0];
        }
        // console.timeEnd('t');
        return coords;
    }

    get coordinates() {
        const {x, y, z} = this.__xyz;
        return decodeGeometry(this._vtf, x, y, z);
    }
}

type TaskData = {xyz:{x:number, y:number, z:number}, mvt:any, triangles: ProcessedMvtResult, l: number, f: number, geojson: any[], layers: any};

export default function mvtPreProcessor(prep) {
    taskManager.create({

        init: function(): TaskData {
            const layers = [];
            const mvt = new VectorTile(new Protobuf(prep.data.mvt));
            const {tile} = prep;
            for (var l in mvt.layers) {
                layers.push(l);
            }
            return {
                xyz: {
                    x: tile.x,
                    y: tile.y,
                    z: tile.z
                },
                mvt,
                triangles: prep.data.triangles,
                layers: layers,
                l: 0,
                f: 0,
                geojson: []
            };
        },

        priority: 4,

        exec: function(data: TaskData) {
            let {mvt, xyz, layers, triangles, l, f, geojson} = data;

            while (l < layers.length) {
                let mvtLayer = mvt.layers[layers[l]];
                let xyzLayer = triangles[l];
                let mvtLayerName = mvtLayer.name;
                // const mvtNs = {layer: layer.name};
                let _xyz = {x: xyz.x, y: xyz.y, z: xyz.z, l: mvtLayerName};

                while (f < mvtLayer.length) {
                    // feature    = layer.feature(f++).toGeoJSON( x, y, z );
                    let feature = vtFeatureToGeoJSON(mvtLayer.feature(f), _xyz, true);
                    let geom = feature.geometry.type;

                    if (geom == 'MultiPolygon' || geom == 'Polygon') {
                        feature.geometry._xyz = xyzLayer?.[f];
                    }
                    // feature.id = /*feature.id ||*/ Math.random();
                    feature.id = ++guid;
                    f++;

                    feature.properties.layer ??= mvtLayer.name;
                    feature.properties.$layer ??= mvtLayer.name;

                    // feature.properties['@ns:com:here:mvt'] = mvtNs;

                    geojson.push(feature);

                    if (!(f % BUNDLE_FEATURE_SIZE)) {
                        data.f = f;
                        return this.CONTINUE;
                    }
                }

                data.l = ++l;
                data.f = 0;

                return this.CONTINUE;
            }

            return this.BREAK;
        },

        onDone: function(data) {
            prep.ready(data.geojson);
        }

    }).start();
};
