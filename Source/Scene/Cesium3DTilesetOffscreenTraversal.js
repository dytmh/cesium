define([
        '../Core/Intersect',
        '../Core/ManagedArray',
        './Cesium3DTileRefine'
    ], function(
        Intersect,
        ManagedArray,
        Cesium3DTileRefine) {
    'use strict';

    /**
     * @private
     */
    function Cesium3DTilesetOffscreenTraversal() {
    }

    var offscreenTraversal = {
        stack : new ManagedArray(),
        stackMaximumLength : 0
    };

    Cesium3DTilesetOffscreenTraversal.selectTiles = function(tileset, minimumGeometricError, statistics, frameState) {
        tileset._offscreenSelectedTiles.length = 0;
        tileset._offscreenRequestedTiles.length = 0;
        tileset._hasMixedContent = false;

        var root = tileset.root;
        root.updateVisibility(frameState);

        if (!isVisible(root)) {
            return false;
        }

        if (root._geometricError <= minimumGeometricError) {
            return false;
        }

        var ready = true;

        var stack = offscreenTraversal.stack;
        stack.push(tileset.root);

        while (stack.length > 0) {
            offscreenTraversal.stackMaximumLength = Math.max(offscreenTraversal.stackMaximumLength, stack.length);

            var tile = stack.pop();
            var add = tile.refine === Cesium3DTileRefine.ADD;
            var replace = tile.refine === Cesium3DTileRefine.REPLACE;
            var refines = false;

            if (canTraverse(tileset, minimumGeometricError, tile)) {
                refines = updateAndPushChildren(tileset, tile, stack, frameState);
            }

            if (add || (replace && !refines)) {
                loadTile(tileset, tile);
                selectDesiredTile(tileset, tile, frameState);

                if (!hasEmptyContent(tile) && !tile.contentAvailable) {
                    ready = false;
                }
            }

            visitTile(statistics);
            touchTile(tileset, tile);
        }

        offscreenTraversal.stack.trim(offscreenTraversal.stackMaximumLength);

        return ready;
    };

    function isVisible(tile) {
        return tile._visible && tile._inRequestVolume;
    }

    function hasEmptyContent(tile) {
        return tile.hasEmptyContent || tile.hasTilesetContent;
    }

    function hasUnloadedContent(tile) {
        return !hasEmptyContent(tile) && tile.contentUnloaded;
    }

    function canTraverse(tileset, minimumGeometricError, tile) {
        if (tile.children.length === 0) {
            return false;
        }

        if (tile.hasTilesetContent) {
            // Traverse external tileset to visit its root tile
            // Don't traverse if the subtree is expired because it will be destroyed
            return !tile.contentExpired;
        }

        if (tile.hasEmptyContent) {
            return true;
        }

        return tile._geometricError >= minimumGeometricError;
    }

    function updateAndPushChildren(tileset, tile, stack, frameState) {
        var children = tile.children;
        var length = children.length;

        var refines = false;
        for (var i = 0; i < length; ++i) {
            var child = children[i];
            child.updateVisibility(frameState);
            if (isVisible(child)) {
                stack.push(child);
                refines = true;
            }
        }
        return refines;
    }

    function loadTile(tileset, tile) {
        if (hasUnloadedContent(tile) || tile.contentExpired) {
            tileset._requestedTiles.push(tile);
        }
    }

    function touchTile(tileset, tile) {
        tileset._offscreenCache.touch(tile);
    }

    function visitTile(statistics) {
        ++statistics.visited;
    }

    function selectDesiredTile(tileset, tile, frameState) {
        if (tile.contentAvailable && (tile.contentVisibility(frameState) !== Intersect.OUTSIDE)) {
            tileset._selectedTiles.push(tile);
        }
    }

    return Cesium3DTilesetOffscreenTraversal;
});
