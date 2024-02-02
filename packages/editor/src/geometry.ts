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

import {GeoJSONCoordinate as Point} from '@here/xyz-maps-core';
import {geometry, geotools, vec3} from '@here/xyz-maps-common';


const MATH = Math;
const PI = MATH.PI;
const pow = MATH.pow;
const sqrt = MATH.sqrt;

export {Point};

export const simplifyPath = (
    path: Point[],
    epsilon: number,
    start: number = 0,
    end: number = path.length,
    simple: Point[] = []
) => {
    // douglas peucker
    let dmax = 0;
    let index = 0;
    end--;

    for (let i = start + 1; i < end; i++) {
        const d = distanceToLine(path[i], path[start], path[end], geotools.distance);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }
    if (dmax > epsilon) {
        simplifyPath(path, epsilon, start, index, simple);
        simplifyPath(path, epsilon, index, end + 1, simple);
    } else {
        simple.push(path[start]);
        if ((end - start) > 0) {
            simple.push(path[end]);
        }
    }
    return simple;
};

export const isPntInRect = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    return px >= x1 && px <= x2 && py >= y1 && py <= y2;
};

export const intersectBBox = geometry.intersectBBox;

export const getAngle = (p1: Point, p2: Point): number => {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];

    return (!dx && !dy) ? 0 : (180 + MATH.atan2(dy, dx) * 180 / PI) % 360;
};


export const movePointOnPath = (g1: Point, g2: Point, distance: number) => {
    // let d = vec3.sub([], g2, g1);
    if (g1[2] == null) {
        g1 = [g1[0], g1[1], 0];
    }
    const d = [g2[0] - g1[0], g2[1] - g1[1], (g2[2] || 0) - g1[2]];
    vec3.scale(d, vec3.normalize(d, d), distance);
    return vec3.add(d, d, g1);
};

export const getClosestPoint = (path: Point[], p: Point, maxDistance?: number) => {
    let minDistance = maxDistance || Infinity;
    let segment = null;
    let distance;

    for (let i = 0; i < path.length; i++) {
        distance = getDistance(path[i], p);

        if (distance < minDistance) {
            minDistance = distance;
            segment = i;
        }
    }
    return path[segment];
};

export const getSegmentIndex = (path: Point[], p: Point): number | false => {
    let minDistance = 999999;
    let segment: number | false = false;

    for (let i = 0; i < path.length - 1; i++) {
        const iNext = i + 1;
        const iPnt = getPntOnLine(path[i], path[iNext], p);
        if (iPnt) {
            const distance = getDistance(iPnt, p);
            if (distance < minDistance) {
                minDistance = distance;
                segment = i;
            }
        }
    }
    return segment;
};

// const ccw = (a: Point, b: Point, c: Point) => {
//     return (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
// };
// export const intersectLineLine2 = (g1p1: Point, g1p2: Point, g2p1: Point, g2p2: Point) => {
//     // if (ccw(g1p1, g1p2, g2p1) * ccw(g1p1, g1p2, g2p2) > 0) return false;
//     // if (ccw(g2p1, g2p2, g1p1) * ccw(g2p1, g2p2, g1p2) > 0) return false;
//     // return true;
// };


export const intersectLineLine3d = (a: number[], b: number[], c: number[], d: number[]) => {
    const r = vec3.sub([], b, a);
    const s = vec3.sub([], d, c);
    const q = vec3.sub([], a, c);

    const dotqr = vec3.dot(q, r);
    const dotqs = vec3.dot(q, s);
    const dotrs = vec3.dot(r, s);
    const dotrr = vec3.dot(r, r);
    const dotss = vec3.dot(s, s);

    const denom = dotrr * dotss - dotrs * dotrs;
    const numer = dotqs * dotrs - dotqr * dotss;

    const t = numer / denom;
    const u = (dotqs + t * dotrs) / dotss;

    const p0 = vec3.add([], a, vec3.scale([], r, t));
    const p1 = vec3.add([], c, vec3.scale([], s, u));

    const onSegment = 0 <= t && t <= 1 && 0 <= u && u <= 1;
    const length = vec3.length(vec3.sub([], p0, p1));
    const intersects = length <= 1e-7;

    return {p0, p1, onSegment, intersects, distance: length};
};


export const intersectLineLine = (g1p1: Point, g1p2: Point, g2p1: Point, g2p2: Point, details?: boolean): boolean | Point => {
    const uB = (g2p2[1] - g2p1[1]) * (g1p2[0] - g1p1[0]) - (g2p2[0] - g2p1[0]) * (g1p2[1] - g1p1[1]);

    if (uB != 0) {
        const uaT = (g2p2[0] - g2p1[0]) * (g1p1[1] - g2p1[1]) - (g2p2[1] - g2p1[1]) * (g1p1[0] - g2p1[0]);
        const ubT = (g1p2[0] - g1p1[0]) * (g1p1[1] - g2p1[1]) - (g1p2[1] - g1p1[1]) * (g1p1[0] - g2p1[0]);
        const ua = uaT / uB;
        const ub = ubT / uB;
        const g1p1z = g1p1[2] || 0;
        const g1p2z = g1p2[2] || 0;
        // const g2p1z = g2p1[2] || 0;
        // const g2p2z = g2p2[2] || 0;
        //
        // if ((uaT * (g1p2z - g1p1z) + ubT * (g2p1z - g2p2z)) == g2p1z - g1p1z) {
        if (0 <= ua && ua <= 1 && 0 <= ub && ub <= 1) {
            return details ? [
                g1p1[0] + ua * (g1p2[0] - g1p1[0]),
                g1p1[1] + ua * (g1p2[1] - g1p1[1]),
                g1p1z + ua * (g1p2z - g1p1z)
            ] : true;
        }
        // }
    }
    return false;
};

export const getPntOnLine = (g1: Point, g2: Point, p: Point): Point | false => {
    if (g1[0] == g2[0]) {
        let iPnt: Point = [g1[0], p[1]];
        return isOnLine(g1, g2, iPnt) ? iPnt : false;
    }
    if (g1[1] == g2[1]) {
        let iPnt: Point = [p[0], g1[1]];
        return isOnLine(g1, g2, iPnt) ? iPnt : false;
    }
    const gM = (g2[1] - g1[1]) / (g2[0] - g1[0]);
    const gB = g1[1] - (gM * g1[0]);
    const pM = -1 / gM;
    const pB = p[1] - (pM * p[0]); // g_m * x + g_b = p_m * x + p_b
    const sX = (pB - gB) / (gM - pM);
    const sY = gM * sX + gB;
    const iPnt: Point = [sX, sY];

    return isOnLine(g1, g2, iPnt) ? iPnt : false;
};

export const getClosestPntOnLine = (l1: Point, l2: Point, p: Point, clamp?: boolean) => {
    const l1p = vec3.sub([], p, l1);
    const l1l2 = vec3.sub([], l2, l1);
    const dir = vec3.sub([], l2, l1);
    let t = vec3.dot(l1l2, l1p) / vec3.dot(l1l2, l1l2);
    if (clamp) {
        t = Math.max(0, Math.min(1, t));
    }
    vec3.scale(dir, dir, t);
    return vec3.add(dir, dir, l1);
};

export const rayIntersectPlane = (rayVector: Point, rayPoint: Point, planeNormal: Point, planePoint: Point, clamp?: boolean) => {
    const d = vec3.sub([], rayPoint, planePoint);
    const p1 = vec3.dot(d, planeNormal);
    const p2 = vec3.dot(rayVector, planeNormal);
    const p3 = p1 / p2;

    if (p3 == Infinity) return null;

    return vec3.sub([], rayPoint, vec3.scale([], rayVector, p3));
};

export const getPntAt = (p1: Point, p2: Point, percent: number): Point => {
    let z1 = p1[2] || 0;
    let z2 = p2[2] || 0;
    return [(p2[0] - p1[0]) * percent + p1[0], (p2[1] - p1[1]) * percent + p1[1], z1 + (z2 - z1) * percent];
};

export const distanceToLine = (p: Point, l1: Point, l2: Point, measure: (p1s: Point, p2: Point) => number = getDistance): number => {
    const px = p[0];
    const py = p[1];
    const l1x = l1[0];
    const l1y = l1[1];
    const l2x = l2[0];
    const l2y = l2[1];
    const dx = l2x - l1x;
    const dy = l2y - l1y;
    const u = ((px - l1x) * dx + (py - l1y) * dy) / (dx * dx + dy * dy);
    let closestLine;

    if (u < 0) {
        closestLine = [l1x, l1y];
    } else if (u > 1) {
        closestLine = [l2x, l2y];
    } else {
        closestLine = [l1x + u * dx, l1y + u * dy];
    }
    return measure([px, py], closestLine);
};

export const distanceToPolygon = (p: Point, poly: Point[]): number => {
    let dist = Infinity;
    const len = poly.length - 1;

    for (let i = 0; i < len; i++) {
        const currDist = distanceToLine(p, poly[i], poly[i + 1]);

        if (currDist < dist) {
            dist = currDist;
        }
    }
    return dist;
};

export const getDistance = (p1: Point, p2: Point): number => {
    return sqrt(pow((p1[0] - p2[0]), 2) + pow((p1[1] - p2[1]), 2));
};

export const isOnLine = (g0: Point, g1: Point, p: Point, tolerance?: number): boolean => {
    // tolerance = tolerance || .001;
    tolerance = tolerance || .0000001;

    const x = p[0] - g0[0];
    const y = p[1] - g0[1];
    let dx = g1[0] - g0[0];
    let dy = g1[1] - g0[1];
    // calc value of l minimizing |P0+l(P1-P0)-P|
    let l = (x * dx + y * dy) / (dx * dx + dy * dy);
    // clip l to lie in [0,1]
    l = (l < 0) ? 0 : (l > 1) ? 1 : l;

    dx = x - l * dx;
    dy = y - l * dy;
    // l now contains square of distance of point from line
    l = dx * dx + dy * dy;
    // square the tol elims possible sqrt(0) errs if l=0
    return l < (tolerance * tolerance);
};

export const getTotalLength = (path: Point[]): number => {
    let tLen = 0;

    for (let i = 0; i < path.length - 1; i++) {
        tLen += getDistance(path[i], path[i + 1]);
    }

    return tLen;
};

export const getSubpath = (path: Point[], len1: number, len2: number) => {
    const p1 = getPointAtLength(path, len1);
    const p2 = getPointAtLength(path, len2);
    const s1 = <number>getSegmentIndex(path, p1);
    const s2 = <number>getSegmentIndex(path, p2);
    const subpath = [p1];

    for (let i = s1 + 1; i < s2 + 1; i++) {
        subpath.push([path[i][0], path[i][1]]);
    }

    subpath.push(p2);

    return subpath;
};

export const getPointAtLength = (path: Point[], atLen: number, clamp: boolean = true): Point => {
    let segLen;
    let curTotalLen = 0;
    let p1;
    let p2;
    let atCurSegLen;

    for (let i = 0; i < path.length - 1; i++) {
        p1 = path[i];
        p2 = path[i + 1];

        curTotalLen += (segLen = getDistance(p1, p2));

        if (!clamp || curTotalLen >= atLen) {
            atCurSegLen = (atLen - (curTotalLen - segLen)) / segLen;
            return [
                (p2[0] - p1[0]) * atCurSegLen + p1[0],
                (p2[1] - p1[1]) * atCurSegLen + p1[1]
            ];
        }
    }
    return p2;
};

export const rotate = (currentPoint, angle, center) => {
    const r = getDistance(center, currentPoint);
    const baseAngle = getAngle(currentPoint, center);

    return [
        center[0] + r * MATH.cos((angle + baseAngle) / 180 * PI),
        center[1] + r * MATH.sin((angle + baseAngle) / 180 * PI)
    ];
};

// getRelPosOfPointOnLine: function(pnt, path){
//    var total_dis = 0,
//        startToPnt_dis = 0;
//
//    for(var i=0; i < path.length-1; i++){
//        var g1 = path[i],
//            g2 = path[i+1];
//
//        //if( that.getPntOnLine(g1, g2, {x:pnt.x,y:pnt.y}) != false ) {
//        if( GeoMath.isOnLine(path[i], path[i+1], pnt) != false ) {
//            startToPnt_dis = total_dis + GeoMath.getDistance( g1, pnt );
//        }
//        total_dis += GeoMath.getDistance(g1, g2);
//    }
//    var relPos = startToPnt_dis/total_dis;
//
//    return relPos;
// };
//
// calcRelPosOfPoiAtLink: function( path, p){
//    var total_len = 0,
//        iPnt = false,
//        segment = { lenPntToLine: 99999, lenTotal: 0, shp: 0 };
//
//    for(var i=0;i<path.length-1;i++){
//
//        var g1 = path[i],
//            g2 = path[i+1],
//            iPnt = GeoMath.getPntOnLine( path[i], path[i+1], p );
//
//        if (iPnt != false) {
//            var lenPntToLine = GeoMath.getDistance(iPnt, p);
//
//            if (lenPntToLine < segment.lenPntToLine) {
//                segment.shp = i;
//                segment.lenPntToLine = lenPntToLine;
//                segment.lenTotal = total_len + GeoMath.getDistance( g1, iPnt );
//            }
//        }
//        total_len += GeoMath.getDistance(g1, g2);
//    }
//
//    //calc nearest node distance
//    var lenToCurShp = 0, nearestShp = {shp:-1, distancePoi: 999999, length: -1};
//    for(var i=0; i<path.length; i++){
//        var dis = GeoMath.getDistance( path[i] , p);
//        i>0 &&
//        ( lenToCurShp += GeoMath.getDistance(
//            path[ i ],
//            path[i-1]
//        ));
//        if( dis < nearestShp.distancePoi ){
//            nearestShp.shp = i;
//            nearestShp.distancePoi = dis;
//            nearestShp.length = lenToCurShp;
//        }
//    }
//
//    //calc the side
//    if(segment.lenPntToLine < nearestShp.distancePoi){
//        var side = GeoMath.calcSideOfLine(
//            p,
//            path[segment.shp],
//            path[segment.shp+1]
//        );
//        return {side: side, offset: segment.lenTotal/total_len, distance: segment.lenPntToLine};
//
//    }else{
//
//        var index = [nearestShp.shp, nearestShp.shp+1];
//        if(nearestShp.shp == path.length-1){ index=[nearestShp.shp-1, nearestShp.shp]; }
//
//        var side = GeoMath.calcSideOfLine(
//            p,
//            path[index[0]],
//            path[index[1]]
//        );
//        return  {side: side, offset: nearestShp.length/total_len, distance: nearestShp.distancePoi};
//    }
// };
//
// calcSideOfLine: function(p, g1, g2){
//    if( g1[0] == g2[0] && g1[1] == g2[1] ){
//        return false;
//    }
//    var dvx = p[0] - g1[0],
//        dvy = p[1] - g1[1],
//        gvx = g2[0] - g1[0],
//        gvy = g2[1] - g1[1],
//
//        direction = (dvx * gvy) - (dvy * gvx);
//    return direction > 0 ? 'L' : 'R';
// };
/*
calcInterceptionAt: function( path, pos, snapTolerance, idx ){
    var index                   = null,
        minDistance             = 4096,
        found_existing_shape    = false,
        found_preference_shape  = false,
        in_preference_segment   = false,
        idx                     = typeof idx == "number" ? idx : -2, // no preference shape by default
        found_x                 = null,
        found_y                 = null,
        p1, pDis, iPnt, distance;

    //calculate index of line for new Shape to add
    for( var i = 0; i < path.length; i++ )
    {
        p1 = path[i];
        //check if a existing pnt is in range
        pDis = GeoMath.getDistance( p1, pos );
        if( pDis <= snapTolerance )
        {
            if( !found_existing_shape && !in_preference_segment && !found_preference_shape )
            {
                minDistance = pDis;
                found_existing_shape = true;
            }

            if( ( i == idx || i == idx +1 ) && !found_preference_shape )
            {
                minDistance = pDis;
            }

            if( pDis <= minDistance )
            {
                if( i == idx || i == idx + 1 || found_preference_shape === false )
                {
                    minDistance = pDis;
                    found_x = p1[0];
                    found_y = p1[1];
                    index = i;
                    in_preference_segment = false;
                    found_existing_shape = true;
                    if( i == idx || i == idx + 1)
                        found_preference_shape = i;
                }
            }
        }
        //calc related segment of line for new Shape
        if (i < path.length - 1 && found_preference_shape === false) {
            iPnt = GeoMath.getPntOnLine(
                path[i],
                path[i + 1],
                pos
            );
            if(iPnt){
                distance = GeoMath.getDistance( iPnt, pos);
                if( i == idx && distance < 4096 || distance < minDistance && !found_existing_shape && !in_preference_segment){
                    minDistance = distance;
                    index = i + 1;
                    found_x = iPnt[0];
                    found_y = iPnt[1];
                    in_preference_segment = i == idx && distance < 4096;
                }
            }
        }
    }

    if( in_preference_segment )
        found_existing_shape = false;

    var intersection           = [ found_x, found_y ];
    intersection.index         = index;
    intersection.existingShape = found_existing_shape;

    return intersection;

    //return {
    //  x: found_x,
    //  y: found_y,
    //  index: index,
    //  existingShape: found_existing_shape
    //}
};
*/
