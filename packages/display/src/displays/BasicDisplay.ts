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

import {global, TaskManager, Color as ColorUtils} from '@here/xyz-maps-common';
import {Tile, TileLayer, CustomLayer, XYZLayerStyle, LayerStyle, Color, Style} from '@here/xyz-maps-core';
import {getElDimension, createCanvas} from '../DOMTools';
import {Layers, Layer, ScreenTile} from './Layers';
import FeatureModifier from './FeatureModifier';
import BasicRender from './BasicRender';
import BasicTile from './BasicTile';
import BasicBucket from './BasicBucket';
import Preview from './Preview';
import Grid, {ViewportTile} from '../Grid';
import {createZoomRangeFunction, getValue, parseColorMap} from './styleTools';

type RGBA = ColorUtils.RGBA;

const CREATE_IF_NOT_EXISTS = true;
const MAX_PITCH_GRID = 60 / 180 * Math.PI;

function toggleLayerEventListener(toggle: string, layer: any, listeners: any) {
    toggle = toggle + 'EventListener';

    if (layer[toggle]) {
        for (var type in listeners) {
            layer[toggle](type, listeners[type]);
        }
    }
}

let UNDEF;

abstract class Display {
    private previewer: Preview;
    private updating: boolean = false;
    private ti: number; // tile index
    private _gridClip: { rz: number, rx: number, s: number, top: number } = {rz: 0, rx: 0, s: 0, top: 0};
    protected viewChange: boolean;
    protected sx: number; // grid/screen offset x (includes scale offset)
    protected sy: number; // grid/screen offset y (includes scale offset)
    protected dirty: boolean = false;

    private centerWorld: number[]; // absolute world center xy0

    protected bgColor: RGBA;
    globalBgc: boolean | Color = false;

    tileSize: number;
    layers: Layers;
    dpr: number;
    canvas: HTMLCanvasElement;
    w: number;
    h: number;
    s: number;
    rx: number;
    rz: number;
    render: BasicRender;
    buckets: BasicBucket;
    listeners: { [event: string]: (a1?, a2?) => void };
    tiles: { [tilesize: string]: ScreenTile[] };

    grid: Grid;

    constructor(mapEl: HTMLElement, tileSize: number, dpr: string | number, bucketPool, tileRenderer: BasicRender, previewLookAhead: number | [number, number]) {
        const display = this;
        const w = getElDimension(mapEl, 'width');
        const h = getElDimension(mapEl, 'height');

        const canvas = createCanvas(mapEl, w, h, 0);

        display.previewer = new Preview(display, previewLookAhead);
        display.grid = new Grid(tileSize);
        display.tiles = {
            256: [],
            512: []
        };
        display.render = tileRenderer;
        // tileRenderer.mapContext = this.mapContext;
        display.tileSize = tileSize;
        display.buckets = bucketPool;
        display.layers = new Layers();
        display.w = w;
        display.h = h;
        display.canvas = canvas;
        canvas.className = 'tmc';
        display.dpr = Display.getPixelRatio(dpr);
        display.setSize(w, h);
        display.setBGColor();

        const featureModifier = new FeatureModifier(display, tileRenderer);

        display.listeners = {
            'clear': (ev) => {
                const {tiles, layer} = ev.detail;
                featureModifier.clear(layer, tiles);
            },

            'featuresAdd': (ev) => {
                const {features, tiles, layer} = ev.detail;
                if (tiles?.length) {
                    featureModifier.add(features, tiles, layer);
                }
            },

            'featuresRemove': (ev) => {
                const {features, tiles, layer} = ev.detail;
                if (tiles) {
                    featureModifier.remove(features, tiles, layer);
                }
            },

            'featureCoordinatesChange': (ev) => {
                const {feature, prevBBox, prevCoordinates, layer} = ev.detail;
                featureModifier.updateGeometry(feature, prevBBox, prevCoordinates, layer);
            },

            'styleGroupChange': (ev) => {
                const {feature, styleGroup, layer} = ev.detail;
                featureModifier.repaint(feature, styleGroup, layer);
            },

            'styleChange': (ev) => {
                const {layer, style} = ev.detail;
                const index = display.layers.indexOf(layer);
                display.setLayerBgColor(style, display.layers[index]);
                display.buckets.tiles.forEach((t) => t.clear(index));
            }
        };
    }

    static getPixelRatio(dpr: string | number | any) {
        dpr = dpr == 'auto'
            ? Math.min(2, global.devicePixelRatio || 1)
            : dpr || 1;

        return dpr < 1 ? 1 : dpr;
    }

    addLayer(layer: TileLayer | CustomLayer, index: number, styles?: XYZLayerStyle): boolean {
        const display = this;
        const layers = display.layers;
        let added = layers.add(layer, index);
        if (added) {
            const dLayer = layers.get(layer);
            display.buckets.forEach((dTile) => {
                dTile.addLayer(index);
            });
            toggleLayerEventListener('add', layer, display.listeners);

            if (layer.custom) return added;

            styles?.clearCache();

            // new function needs to be created per layer otherwise a setup with same provider used
            // accross multiple layers will lead in case of cancel to cancel all layers.
            dLayer.handleTile = (tile) => {
                // is tile still visible ?
                if (display.isVisible(tile, dLayer)) {
                    display.handleTile(tile, <TileLayer>layer);
                }
            };

            if (index == 0) {
                display.setLayerBgColor(layer.getStyle(), dLayer);
            }
        }
        return added;
    }

    removeLayer(layer: TileLayer | CustomLayer): number {
        const display = this;
        const layers = this.layers;
        const dLayer = layers.get(layer);
        const tiles = dLayer.tiles;
        const index = layers.indexOf(layer);

        if (index !== -1) {
            display.buckets.forEach((dTile) => {
                dTile.cancelTasks(<TileLayer>layer);
                dTile.removeLayer(index);
            });

            for (let screenTile of tiles) {
                const quadkey = screenTile.tile.quadkey;
                display.releaseTile(quadkey, dLayer);
                display.cancel(quadkey, <TileLayer>layer);
            }

            layers.remove(layer);

            toggleLayerEventListener('remove', layer, display.listeners);
        }
        return index;
    }

    getBucket(quadkey: string, createIfNotExists?: boolean): BasicTile {
        const display = this;
        let bucket;

        if (createIfNotExists) {
            bucket = display.buckets.create(quadkey, <any[]><unknown>display.layers);
        } else {
            bucket = display.buckets.get(quadkey);
        }
        return bucket;
    }

    handleTile(tile: Tile, layer: TileLayer, displayTile?: BasicTile, index?: number) {
        const display = this;
        let dirty = false;
        let data;

        if (displayTile) {
            dirty = true;
        } else {
            displayTile = display.getBucket(tile.quadkey, CREATE_IF_NOT_EXISTS);
        }

        if (index == UNDEF) {
            index = display.layers.indexOf(layer);
        }

        if (tile.error) {
            display.layers[index].error = true;
        }

        // prepare tile data for rendering. process/prerender vector data
        if (!displayTile.ready(index) && !displayTile.busy(layer)) {
            if (data = tile.data) {
                const tileProcessed = (dTile: BasicTile, layer: TileLayer) => {
                    // in case of local data is getting added to a remote provider..
                    // before data is fetched from remote
                    // => we need to "wait" otherwise remote update is missed.
                    if (tile.isLoaded()) {
                        dTile.ready(dTile.index(layer), true);
                    }
                    display.update(dirty);
                };
                displayTile.ready(index, false);
                // @ts-ignore
                let layerRender = layer.render;
                // experimental
                if (layerRender) {
                    layerRender(tile, data, layer, displayTile, tileProcessed);
                } else {
                    display.prepareTile(tile, data, layer, displayTile, tileProcessed);
                }
            }
        }
    };

    protected abstract viewport();

    abstract prepareTile(tile: Tile, data, layer: TileLayer, dTile: BasicTile, onDone: (dTile: BasicTile, layer: TileLayer) => void);

    abstract unproject(x: number, y: number, z?: number): number[];

    abstract project(x: number, y: number, z?: number): number[];

    private setLayerBgColor(style, dLayer: Layer) {
        let {backgroundColor} = style;
        if (backgroundColor) {
            if (typeof backgroundColor == 'object' && !Array.isArray(backgroundColor)) {
                backgroundColor = createZoomRangeFunction(parseColorMap(backgroundColor));
            }
            dLayer.bgColor = typeof backgroundColor == 'function'
                ? backgroundColor
                : this.render.convertColor(backgroundColor);
        }
    }

    private processLayerBackgroundColor(zoomlevel?: number) {
        const display = this;
        const layers = display.layers;
        let bgColor = layers[0]?.bgColor;

        if (typeof bgColor == 'function') {
            bgColor = display.render.convertColor(bgColor(zoomlevel));
        }
        this.bgColor = bgColor || display.globalBgc;
    }

    private isVisible(tile: Tile, dLayer: Layer): boolean {
        const qk = tile.quadkey;
        for (let screen of dLayer.tiles) {
            if (screen.tile.quadkey == qk) {
                return true;
            }
        }
        return false;
    }


    getContext() {
        return this.render.getContext();
    }

    copyCanvas2d(dx: number = 0, dy: number = 0, w: number = this.w, h: number = this.h): HTMLCanvasElement {
        const {canvas, dpr} = this;
        dx *= dpr;
        dy *= dpr;
        w *= dpr;
        h *= dpr;
        const cpyCanvas = <HTMLCanvasElement>document.createElement('Canvas');
        cpyCanvas.width = w;
        cpyCanvas.height = h;
        this.viewport();
        cpyCanvas.getContext('2d').drawImage(canvas, dx, dy, w, h, 0, 0, w, h);
        return cpyCanvas;
    }


    getScreenTile(quadkey: string, tileSize: number): ViewportTile {
        return this.grid.tiles[<256 | 512>tileSize].find((tile) => tile.quadkey == quadkey);
    }

    // USED BY FEATUREMODIFIER
    updateTile(tile: Tile, dTile: BasicTile, layer: TileLayer, feature?) {
        if (!dTile) return;
        const pendingTask = dTile.busy(layer);
        if (pendingTask) {
            if (pendingTask.isInterrupted()) {
                pendingTask.outdated = true;
            }
        } else {
            const display = this;
            const index = dTile.index(layer);
            dTile.ready(index, false);
            // clear preview to enable preview creation for next render iteration
            // dTile.p[index] = false;
            display.layers[index].handleTile(tile);
        }
    }

    setSize(w: number, h: number) {
        var display = this;
        var dpr = display.dpr;
        var canvas = display.canvas;

        display.w = w;
        display.h = h;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
    }

    cancel(quadkey: string, layer?: TileLayer) {
        const dTile = this.buckets.get(quadkey, true/* SKIP TRACK */);
        if (dTile) {
            dTile.cancelTasks(layer);
        }
    }


    preview(displayTile: BasicTile, layer: TileLayer, index: number): any[][] {
        const previewData = this.previewer.create(displayTile, layer);
        displayTile.preview(index, previewData);

        return previewData;
    }


    private initVpTiles(gridTiles, zoomLevel: number, gridTileSize: number) {
        const display = this;
        const layers: Layer[] = <Layer[]><unknown> this.layers;

        const prevVPTiles = display.tiles[gridTileSize];
        let vpTiles = display.tiles[gridTileSize] = [];
        const screenTiles = [];

        for (let gridTile of gridTiles) {
            const {x, y, quadkey} = gridTile;
            const displayTile = display.getBucket(quadkey, CREATE_IF_NOT_EXISTS);
            const tilePosition = new ScreenTile(x, y, gridTileSize, displayTile);

            displayTile.i = ++this.ti;

            screenTiles.push(tilePosition);
            vpTiles.push(tilePosition);

            for (let dLayer of layers) {
                let layer = <TileLayer>dLayer.layer;

                if (!layer.tiled) continue;

                let layerTileSize = layer.tileSize || 256;

                if (layerTileSize == gridTileSize) {
                    if (layer.isVisible(zoomLevel)) {
                        dLayer.tiles = screenTiles;
                        display.initTile(displayTile, dLayer);
                        layer.getTile(quadkey, dLayer.handleTile);
                    }
                }
            }
        }

        // mark tiles to not be visible anymore
        prevVPTiles.forEach((tilePos) => {
            const qk = tilePos.tile.quadkey;
            for (let vpTile of vpTiles) {
                if (vpTile.tile.quadkey == qk) {
                    return;
                }
            }

            for (let dLayer of layers) {
                if ((<TileLayer>dLayer.layer).tileSize == gridTileSize) {
                    display.releaseTile(qk, dLayer);
                }
            }
            display.cancel(qk);
        });
    }

    protected getCamGroundPositionScreen() {
        return [this.w / 2, this.h / 2];
    }

    private clipGridHeight(maxPitch: number) {
        const {rz, rx, s, _gridClip, centerWorld} = this;
        // cache result for the current map transform
        if (_gridClip.rx != rx || _gridClip.rz != rz
        // || _gridClip.s != s
        ) {
            _gridClip.rz = rz;
            _gridClip.rx = rx;
            // _gridClip.s = s;
            // this.setTransform(s, rz, -maxPitch);
            this.setView(centerWorld, s, rz, -maxPitch);

            const topAtMaxPitch = this.unproject(this.w / 2, 0);
            // this.setTransform(s, rz, rx);
            this.setView(centerWorld, s, rz, rx);
            _gridClip.top = this.project(topAtMaxPitch[0], topAtMaxPitch[1])[1];
        }
        return _gridClip.top;
    }

    updateGrid(tileGridZoom: number, zoomLevel: number, screenOffsetX: number, screenOffsetY: number) {
        const centerWorldPixel = this.centerWorld;
        // const screenOffsetX = this.sx;
        // const screenOffsetY = this.sy;
        // const worldSize = Math.pow(2, zoomlevel) * this.tileSize;

        this.processLayerBackgroundColor(zoomLevel);
        this.layers.setZoom(zoomLevel);

        this.viewChange = true;
        this.sx = screenOffsetX;
        this.sy = screenOffsetY;

        const display = this;
        const rotZRad = this.rz;
        const mapWidthPixel = this.w;
        const mapHeightPixel = this.h;
        const displayWidth = mapWidthPixel;
        // Be sure to also handle tiles that are not part of the actual viewport but whose data is still visible because of high altitude.
        const displayHeight = Math.max(mapHeightPixel, this.getCamGroundPositionScreen()[1]);
        const grid = this.grid;
        let height = 0;

        // if map is pitched too much, we clip the grid at the top
        if (-this.rx > MAX_PITCH_GRID) {
            height = this.clipGridHeight(MAX_PITCH_GRID);
        }

        // optimize gird if screen is rotated
        let rotatedScreenPixels = [
            display.unproject(0, height),
            display.unproject(displayWidth - 1, height),
            display.unproject(displayWidth - 1, displayHeight - 1),
            display.unproject(0, displayHeight - 1)
        ];

        grid.init(centerWorldPixel, rotZRad, mapWidthPixel, mapHeightPixel, rotatedScreenPixels);

        const layers = this.layers;
        const tileSizes = layers.reset(tileGridZoom/* + Math.log(this.s) / Math.LN2*/);
        this.ti = 0;

        for (let tileSize of tileSizes) {
            const gridTiles = display.grid.getTiles(tileGridZoom - Number(tileSize == 512), tileSize);
            this.initVpTiles(gridTiles, tileGridZoom, tileSize);
        }

        if (tileSizes.indexOf(512) == -1) {
            // 512er tile-grid is used for collision detection.
            // so we need to make sure grid is initialised with 512er tiles.
            display.grid.getTiles(tileGridZoom - 1, 512);
        }

        this.dirty = true;

        display.update();
    }

    releaseTile(quadkey: string, dLayer: Layer) {
        const tileLayer = <TileLayer>dLayer.layer;
        const tile = tileLayer.getCachedTile(quadkey);

        if (tile && tile.loadStartTs) {
            if (!tile.isLoaded()) {
                tileLayer.cancelTile(tile, dLayer.handleTile);
            }
        }
    }

    private initTile(displayTile: BasicTile, dLayer: Layer) {
        const index = dLayer.index;
        const display = this;

        if (dLayer.visible) {
            if (!displayTile.ready(index) && !displayTile.preview(index)) {
                display.preview(displayTile, dLayer.layer as TileLayer, index);
            }
        } else {
            // if layer is not visible displaytiles need to be marked as ready to stop renderloop.
            displayTile.ready(index, true);
        }
    }


    update(dirty?: boolean) {
        const display = this;

        display.dirty ||= dirty;

        if (!display.updating) {
            display.updating = true;
            requestAnimationFrame(() => {
                display.viewport();
                display.updating = false;
            });
        }
    }

    setBGColor(color: Color = '#ffffff') {
        const displ = this;
        const {render} = displ;

        if (color == 'transparent') {
            color = 'rgba(0, 0, 0, 0)';
        }

        color = render.convertColor(color);

        displ.globalBgc = color;

        render.setBackgroundColor(color);
    }

    showGrid(show: boolean | { [opt: string]: any }) {
        this.render.grid(show);
    }

    setView(
        centerWorld: number[],
        scale: number,
        rotZ: number,
        rotX: number,
        groundResolution?: number,
        worldSizePixel?: number
    ) {
        this.centerWorld = centerWorld;
        this.setTransform(scale, rotZ, rotX);
    }

    protected setTransform(scale: number, rotZ: number, rotX: number) {
        this.render.setScale(this.s = scale, 0, 0);
        this.render.setRotation(this.rz = rotZ, this.rx = rotX);
        this.render.applyTransform();
    }

    getLayers() {
        return this.layers;
    }

    destroy() {
        this.render.destroy();
        var canvas = this.canvas;
        canvas.parentElement.removeChild(canvas);
        canvas.width = canvas.height = 1;
    }

    clearLayer(layer: TileLayer) {
        const index = this.getLayers().indexOf(layer);
        this.buckets.forEach((dTile) => {
            dTile.preview(index, false);
            dTile.ready(index, false);
        });
    };

    viewChangeDone() {
        this.viewChange = false;
    }

    /**
     * Returns the topmost rendered feature on the screen.
     *
     * @param screenX x position on screen
     * @param screenY y position
     * @param layers
     *
     * @internal
     * @hidden
     */
    getRenderedFeatureAt(screenX: number, screenY: number, layers?: (TileLayer | CustomLayer)[]): {
        id: number | string | null,
        z?: number,
        layer?: TileLayer,
        pointWorld?: number[]
    } {
        return {id: null};
    }

    scaleOffsetXYByAltitude(pointWorld: number[]) {
        // compensate altitude scaling is not supported by default
        return 1;
    }
}


export default Display;
