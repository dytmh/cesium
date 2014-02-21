/*global define*/
define([
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/Cartographic',
        '../Core/DeveloperError',
        '../Core/Event',
        '../Core/loadXML',
        '../Core/Extent',
        './Credit',
        './ImageryProvider',
        './WebMercatorTilingScheme',
        './GeographicTilingScheme'
    ], function(
        defaultValue,
        defined,
        defineProperties,
        Cartographic,
        DeveloperError,
        Event,
        loadXML,
        Extent,
        Credit,
        ImageryProvider,
        WebMercatorTilingScheme,
        GeographicTilingScheme) {
    "use strict";

    var trailingSlashRegex = /\/$/;

    /**
     * Provides tiled imagery as generated by <a href='http://www.maptiler.org/'>MapTiler</a> / <a href='http://www.klokan.cz/projects/gdal2tiles/'>GDDAL2Tiles</a> etc.
     *
     * @alias TileMapServiceImageryProvider
     * @constructor
     *
     * @param {String} [description.url='.'] Path to image tiles on server.
     * @param {String} [description.fileExtension='png'] The file extension for images on the server.
     * @param {Object} [description.proxy] A proxy to use for requests. This object is expected to have a getURL function which returns the proxied URL.
     * @param {Credit|String} [description.credit=''] A credit for the data source, which is displayed on the canvas.
     * @param {Number} [description.minimumLevel=0] The minimum level-of-detail supported by the imagery provider.  Take care when specifying
     *                 this that the number of tiles at the minimum level is small, such as four or less.  A larger number is likely
     *                 to result in rendering problems.
     * @param {Number} [description.maximumLevel=18] The maximum level-of-detail supported by the imagery provider.
     * @param {Extent} [description.extent=Extent.MAX_VALUE] The extent, in radians, covered by the image.
     * @param {TilingScheme} [description.tilingScheme] The tiling scheme specifying how the ellipsoidal
     * surface is broken into tiles.  If this parameter is not provided, a {@link WebMercatorTilingScheme}
     * is used.
     * @param {Number} [description.tileWidth=256] Pixel width of image tiles.
     * @param {Number} [description.tileHeight=256] Pixel height of image tiles.
     *
     * @see ArcGisMapServerImageryProvider
     * @see BingMapsImageryProvider
     * @see GoogleEarthImageryProvider
     * @see OpenStreetMapImageryProvider
     * @see SingleTileImageryProvider
     * @see WebMapServiceImageryProvider
     *
     * @see <a href='http://www.maptiler.org/'>MapTiler</a>
     * @see <a href='http://www.klokan.cz/projects/gdal2tiles/'>GDDAL2Tiles</a>
     * @see <a href='http://www.w3.org/TR/cors/'>Cross-Origin Resource Sharing</a>
     *
     * @example
     * // TileMapService tile provider
     * var tms = new Cesium.TileMapServiceImageryProvider({
     *    url : '../images/cesium_maptiler/Cesium_Logo_Color',
     *    fileExtension: 'png',
     *    maximumLevel: 4,
     *    extent: new Cesium.Extent(
     *        Cesium.Math.toRadians(-120.0),
     *        Cesium.Math.toRadians(20.0),
     *        Cesium.Math.toRadians(-60.0),
     *        Cesium.Math.toRadians(40.0))
     * });
     */
    var TileMapServiceImageryProvider = function TileMapServiceImageryProvider(description) {
        description = defaultValue(description, {});

        //>>includeStart('debug', pragmas.debug);
        if (!defined(description.url)) {
            throw new DeveloperError('description.url is required.');
        }
        //>>includeEnd('debug');

        var url = description.url;

        if (!trailingSlashRegex.test(url)) {
            url = url + '/';
        }

        this._url = url;
        this._ready = false;
        this._proxy = description.proxy;
        this._tileDiscardPolicy = description.tileDiscardPolicy;
        this._errorEvent = new Event();

        var credit = description.credit;
        if (typeof credit === 'string') {
            credit = new Credit(credit);
        }
        this._credit = credit;

        var that = this;

        // Try to load remaining parameters from XML
        loadXML(url + 'tilemapresource.xml').then(function(xml) {
            var tileFormatRegex = /tileformat/i;
            var tileSetRegex = /tileset/i;
            var tileSetsRegex = /tilesets/i;
            var bboxRegex = /boundingbox/i;
            var format, bbox, tilesets;
            var tilesetsList = []; //list of TileSets
            // Allowing description properties to override XML values
            var nodeList = xml.childNodes[0].childNodes;
            // Iterate XML Document nodes for properties
            for (var i = 0; i < nodeList.length; i++){
                if (tileFormatRegex.test(nodeList.item(i).nodeName)){
                    format = nodeList.item(i);
                } else if (tileSetsRegex.test(nodeList.item(i).nodeName)){
                    tilesets = nodeList.item(i); // Node list of TileSets
                    var tileSetNodes = nodeList.item(i).childNodes;
                    // Iterate the nodes to find all TileSets
                    for(var j = 0; j < tileSetNodes.length; j++){
                        if (tileSetRegex.test(tileSetNodes.item(j).nodeName)){
                            // Add them to tilesets list
                            tilesetsList.push(tileSetNodes.item(j));
                        }
                    }
                } else if (bboxRegex.test(nodeList.item(i).nodeName)){
                    bbox = nodeList.item(i);
                }
            }
            that._fileExtension = defaultValue(description.fileExtension, format.getAttribute('extension'));
            that._tileWidth = defaultValue(description.tileWidth, parseInt(format.getAttribute('width'), 10));
            that._tileHeight = defaultValue(description.tileHeight, parseInt(format.getAttribute('height'), 10));
            that._minimumLevel = defaultValue(description.minimumLevel, parseInt(tilesetsList[0].getAttribute('order'), 10));
            that._maximumLevel = defaultValue(description.maximumLevel, parseInt(tilesetsList[tilesetsList.length - 1].getAttribute('order'), 10));

            // extent handling
            that._extent = description.extent;
            if (!defined(that._extent)) {
                var sw = Cartographic.fromDegrees(parseFloat(bbox.getAttribute('miny')), parseFloat(bbox.getAttribute('minx')));
                var ne = Cartographic.fromDegrees(parseFloat(bbox.getAttribute('maxy')), parseFloat(bbox.getAttribute('maxx')));
                that._extent = new Extent(sw.longitude, sw.latitude, ne.longitude, ne.latitude);
            } else {
                that._extent = Extent.clone(that._extent);
            }

            // tiling scheme handling
            var tilingScheme = description.tilingScheme;
            if (!defined(tilingScheme)) {
                var tilingSchemeName = tilesets.getAttribute('profile');
                tilingScheme = tilingSchemeName === 'geodetic' ? new GeographicTilingScheme() : new WebMercatorTilingScheme();
            }

            // The extent must not be outside the bounds allowed by the tiling scheme.
            if (that._extent.west < tilingScheme.getExtent().west) {
                that._extent.west = tilingScheme.getExtent().west;
            }
            if (that._extent.east > tilingScheme.getExtent().east) {
                that._extent.east = tilingScheme.getExtent().east;
            }
            if (that._extent.south < tilingScheme.getExtent().south) {
                that._extent.south = tilingScheme.getExtent().south;
            }
            if (that._extent.north > tilingScheme.getExtent().north) {
                that._extent.north = tilingScheme.getExtent().north;
            }

            // Check the number of tiles at the minimum level.  If it's more than four,
            // try requesting the lower levels anyway, because starting at the higher minimum
            // level will cause too many tiles to be downloaded and rendered.
            var swTile = tilingScheme.positionToTileXY(that._extent.getSouthwest(), that._minimumLevel);
            var neTile = tilingScheme.positionToTileXY(that._extent.getNortheast(), that._minimumLevel);
            var tileCount = (Math.abs(neTile.x - swTile.x) + 1) * (Math.abs(neTile.y - swTile.y) + 1);
            if (tileCount > 4) {
                that._minimumLevel = 0;
            }

            that._tilingScheme = tilingScheme;
            that._ready = true;
        }, function(error) {
            // Can't load XML, still allow description and defaults
            that._fileExtension = defaultValue(description.fileExtension, 'png');
            that._tileWidth = defaultValue(description.tileWidth, 256);
            that._tileHeight = defaultValue(description.tileHeight, 256);
            that._minimumLevel = defaultValue(description.minimumLevel, 0);
            that._maximumLevel = defaultValue(description.maximumLevel, 18);
            that._tilingScheme = defaultValue(description.tilingScheme, new WebMercatorTilingScheme());
            that._extent = defaultValue(description.extent, that._tilingScheme.getExtent());
            that._ready = true;
        });

    };

    function buildImageUrl(imageryProvider, x, y, level) {
        var yTiles = imageryProvider._tilingScheme.getNumberOfYTilesAtLevel(level);
        var url = imageryProvider._url + level + '/' + x + '/' + (yTiles - y - 1) + '.' + imageryProvider._fileExtension;

        var proxy = imageryProvider._proxy;
        if (defined(proxy)) {
            url = proxy.getURL(url);
        }

        return url;
    }


    defineProperties(TileMapServiceImageryProvider.prototype, {
        /**
         * Gets the URL of the service hosting the imagery.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {String}
         */
        url : {
            get : function() {
                return this._url;
            }
        },

        /**
         * Gets the proxy used by this provider.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Proxy}
         */
        proxy : {
            get : function() {
                return this._proxy;
            }
        },

        /**
         * Gets the width of each tile, in pixels. This function should
         * not be called before {@link TileMapServiceImageryProvider#ready} returns true.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Number}
         */
        tileWidth : {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (!this._ready) {
                    throw new DeveloperError('tileWidth must not be called before the imagery provider is ready.');
                }
                //>>includeEnd('debug');

                return this._tileWidth;
            }
        },

        /**
         * Gets the height of each tile, in pixels.  This function should
         * not be called before {@link TileMapServiceImageryProvider#ready} returns true.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Number}
         */
        tileHeight: {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (!this._ready) {
                    throw new DeveloperError('tileHeight must not be called before the imagery provider is ready.');
                }
                //>>includeEnd('debug');

                return this._tileHeight;
            }
        },

        /**
         * Gets the maximum level-of-detail that can be requested.  This function should
         * not be called before {@link TileMapServiceImageryProvider#ready} returns true.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Number}
         */
        maximumLevel : {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (!this._ready) {
                    throw new DeveloperError('maximumLevel must not be called before the imagery provider is ready.');
                }
                //>>includeEnd('debug');

                return this._maximumLevel;
            }
        },

        /**
         * Gets the minimum level-of-detail that can be requested.  This function should
         * not be called before {@link TileMapServiceImageryProvider#ready} returns true.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Number}
         */
        minimumLevel : {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (!this._ready) {
                    throw new DeveloperError('minimumLevel must not be called before the imagery provider is ready.');
                }
                //>>includeEnd('debug');

                return this._minimumLevel;
            }
        },

        /**
         * Gets the tiling scheme used by this provider.  This function should
         * not be called before {@link TileMapServiceImageryProvider#ready} returns true.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {TilingScheme}
         */
        tilingScheme : {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (!this._ready) {
                    throw new DeveloperError('tilingScheme must not be called before the imagery provider is ready.');
                }
                //>>includeEnd('debug');

                return this._tilingScheme;
            }
        },

        /**
         * Gets the extent, in radians, of the imagery provided by this instance.  This function should
         * not be called before {@link TileMapServiceImageryProvider#ready} returns true.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Extent}
         */
        extent : {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (!this._ready) {
                    throw new DeveloperError('extent must not be called before the imagery provider is ready.');
                }
                //>>includeEnd('debug');

                return this._extent;
            }
        },

        /**
         * Gets the tile discard policy.  If not undefined, the discard policy is responsible
         * for filtering out "missing" tiles via its shouldDiscardImage function.  If this function
         * returns undefined, no tiles are filtered.  This function should
         * not be called before {@link TileMapServiceImageryProvider#ready} returns true.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {TileDiscardPolicy}
         */
        tileDiscardPolicy : {
            get : function() {
                //>>includeStart('debug', pragmas.debug);
                if (!this._ready) {
                    throw new DeveloperError('tileDiscardPolicy must not be called before the imagery provider is ready.');
                }
                //>>includeEnd('debug');

                return this._tileDiscardPolicy;
            }
        },

        /**
         * Gets an event that is raised when the imagery provider encounters an asynchronous error.  By subscribing
         * to the event, you will be notified of the error and can potentially recover from it.  Event listeners
         * are passed an instance of {@link TileProviderError}.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Event}
         */
        errorEvent : {
            get : function() {
                return this._errorEvent;
            }
        },

        /**
         * Gets a value indicating whether or not the provider is ready for use.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Boolean}
         */
        ready : {
            get : function() {
                return this._ready;
            }
        },

        /**
         * Gets the credit to display when this imagery provider is active.  Typically this is used to credit
         * the source of the imagery.  This function should not be called before {@link TileMapServiceImageryProvider#ready} returns true.
         * @memberof TileMapServiceImageryProvider.prototype
         * @type {Credit}
         */
        credit : {
            get : function() {
                return this._credit;
            }
        }
    });

    /**
     * Gets the credits to be displayed when a given tile is displayed.
     *
     * @memberof TileMapServiceImageryProvider
     *
     * @param {Number} x The tile X coordinate.
     * @param {Number} y The tile Y coordinate.
     * @param {Number} level The tile level;
     *
     * @returns {Credit[]} The credits to be displayed when the tile is displayed.
     *
     * @exception {DeveloperError} <code>getTileCredits</code> must not be called before the imagery provider is ready.
     */
    TileMapServiceImageryProvider.prototype.getTileCredits = function(x, y, level) {
        return undefined;
    };

    /**
     * Requests the image for a given tile.  This function should
     * not be called before {@link TileMapServiceImageryProvider#ready} returns true.
     *
     * @memberof TileMapServiceImageryProvider
     *
     * @param {Number} x The tile X coordinate.
     * @param {Number} y The tile Y coordinate.
     * @param {Number} level The tile level.
     *
     * @returns {Promise} A promise for the image that will resolve when the image is available, or
     *          undefined if there are too many active requests to the server, and the request
     *          should be retried later.  The resolved image may be either an
     *          Image or a Canvas DOM object.
     */
    TileMapServiceImageryProvider.prototype.requestImage = function(x, y, level) {
        //>>includeStart('debug', pragmas.debug);
        if (!this._ready) {
            throw new DeveloperError('requestImage must not be called before the imagery provider is ready.');
        }
        //>>includeEnd('debug');

        var url = buildImageUrl(this, x, y, level);
        return ImageryProvider.loadImage(this, url);
    };

    return TileMapServiceImageryProvider;
});
