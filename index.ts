import vt from '@mapbox/vector-tile'
import request from 'request'
import Protobuf from 'pbf'
import fs from 'node:fs'
import url from 'url'
import zlib from 'zlib'
import util from 'node:util'
const format = util.format

export const geojsonFromVt = (args, buffer) => {
    // handle zipped buffers
    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
        buffer = zlib.inflateSync(buffer)
    } else if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
        buffer = zlib.gunzipSync(buffer)
    }

    const tile = new vt.VectorTile(new Protobuf(buffer))
    let layers = args.layer || Object.keys(tile.layers)

    if (!Array.isArray(layers)) layers = [layers]

    const features: any[] = []
    const collection = { type: 'FeatureCollection', features }

    layers.forEach(layerID => {
        const layer = tile.layers[layerID]
        if (layer) {
            for (let i = 0; i < layer.length; i++) {
                const feature = layer
                    .feature(i)
                    .toGeoJSON(args.x, args.y, args.z)
                if (layers.length > 1) feature.properties.vt_layer = layerID
                features.push(feature)
            }
        }
    })

    return collection
}

export default async args => {
    let geoJsonTile: any = null
    let tileBuffer: any = null
    let tileResponse: any = null
    if (!args.uri) {
        return console.error(
            'No URI found. Please provide a valid URI to your vector tile.'
        )
    }

    // handle zxy stuffs
    if (args.x === undefined || args.y === undefined || args.z === undefined) {
        const zxy = args.uri.match(/\/(\d+)\/(\d+)\/(\d+)/)
        if (!zxy || zxy.length < 4) {
            return console.error(
                format(
                    'Could not determine tile z, x, and y from %s; specify manually with -z <z> -x <x> -y <y>',
                    JSON.stringify(args.uri)
                )
            )
        } else {
            args.z = zxy[1]
            args.x = zxy[2]
            args.y = zxy[3]
        }
    }

    const parsed: any = url.parse(args.uri)
    const parsedProtocol = parsed.protocol
    if (parsedProtocol === 'http:' || parsedProtocol === 'https:') {
        const headers = args.headers
        await new Promise((resolve, reject) => {
            request.get(
                {
                    url: args.uri,
                    gzip: true,
                    encoding: null,
                    ...(headers && { headers }),
                },
                (err, response, body) => {
                    // console.log('args, body, :', args, body)
                    tileResponse = response

                    if (err) {
                        reject()
                        return console.error(err)
                    }
                    if (response.statusCode === 401) {
                        reject()
                        return console.error('Invalid Token')
                    }
                    if (response.statusCode !== 200) {
                        reject()
                        return console.error(
                            format(
                                'Error retrieving data from %s. Server responded with code: %s',
                                JSON.stringify(args.uri),
                                response.statusCode
                            )
                        )
                    }

                    tileBuffer = body
                    geoJsonTile = geojsonFromVt(args, body)

                    resolve(geoJsonTile)
                }
            )
        })
    } else {
        if (parsedProtocol === 'file:') {
            args.uri = parsed.host + parsed.pathname
        }
        fs.lstat(args.uri, (err, stats) => {
            if (err) throw err
            if (stats.isFile()) {
                const data = fs.readFileSync(args.uri)
                // tileBuffer = body
                geoJsonTile = geojsonFromVt(args, data)
            }
        })
    }

    return {
        geoJsonTile,
        tileBuffer,
        tileResponse,
    }
}
