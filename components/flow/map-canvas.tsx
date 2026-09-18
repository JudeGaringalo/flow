'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type { Map as LibreMap, Marker as LibreMarker, } from 'maplibre-gl';
import { useFlow } from '@/hooks/use-flow';
import { config } from '@/lib/config';
import type { FlowNode, MapHandle } from '@/lib/types';

/**
 * F.L.O.W. geographic map.
 *
 * MapLibre handles the WebGL map itself.
 * FLOW markers and application state stay inside React.
 */
export const MapCanvas = forwardRef<MapHandle>(
  function MapCanvas(_, ref) {
    const flow = useFlow();
    const latest = useRef(flow);
    latest.current = flow;
    const container = useRef<HTMLDivElement>(null);
    const map = useRef<LibreMap | null>(null);
    const mapModule = useRef<typeof import('maplibre-gl') | null>(null);
    const markers = useRef(new Map<string, LibreMarker>());
    const userMarker = useRef<LibreMarker | null>(null);
    const [hosts, setHosts] = useState<{
      id: string;
      element: HTMLElement;
    }[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [mapError, setMapError] = useState(false);
    const [size, setSize] = useState({
      w: 390,
      h: 720,
    });
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({
      x: 0,
      y: 0,
    });
    const [user, setUser] = useState<{
      latitude: number;
      longitude: number;
      accuracy: number;
    } | null>(null);
    const drag = useRef<{
      x: number;
      y: number;
      ox: number;
      oy: number;
      didMove: boolean;
    } | null>(null);
    /**
     * Bounds used only by the fallback schematic map.
     */
    const bounds = useMemo(
      () => {
        if (!flow.nodes.length) {
          return {
            minLon: 121.002,
            maxLat: 14.602,
            spanLon: 0.063,
            spanLat: 0.062,
          };
        }

        const lons = flow.nodes.map((node) => node.longitude);
        const lats = flow.nodes.map((node) => node.latitude);
        const spanLon = Math.max(0.006, Math.max(...lons) - Math.min(...lons)) * 1.5;
        const spanLat = Math.max(0.006, Math.max(...lats) - Math.min(...lats)) * 1.5;
        return {
          minLon: (Math.max(...lons) +
            Math.min(...lons) -
            spanLon) /
            2,
          maxLat: (Math.max(...lats) +
            Math.min(...lats) +
            spanLat) /
            2,
          spanLon,
          spanLat,
        };
      },
      [flow.nodes]
    );
    /**
     * Geometry used for the fallback map.
     */
    const geometry = useMemo(
      () => {
        const scale = Math.max(size.w / 1250, size.h / 1200);
        return {
          scale,
          x: (size.w - 1250 * scale) / 2 +
            offset.x,
          y: (size.h - 1200 * scale) / 2 +
            offset.y,
        };
      },
      [size, offset]
    );
    /**
     * Convert geographic coordinates into our
     * fallback SVG coordinate space.
     */
    const project = useCallback(
      (node: {
        latitude: number;
        longitude: number;
      }) => {
        return [
          ((node.longitude - bounds.minLon) /
            bounds.spanLon) *
          1250,
          ((bounds.maxLat - node.latitude) /
            bounds.spanLat) *
          1200,
        ];
      },
      [bounds]
    );
    /**
     * Focus the map on one FLOW node.
     */
    const focus = useCallback(
      (id: string) => {
        const currentFlow = latest.current;
        const node = currentFlow.nodes.find((item) => item.id === id);
        if (!node)
          return;

        const mobile = window.innerWidth <= 760;
        /**
         * Real MapLibre map.
         */
        if (map.current && loaded) {
          map.current.easeTo(
            {
              center: [
                node.longitude,
                node.latitude,
              ],
              zoom: Math.max(map.current.getZoom(), 14),
              offset: mobile
                ? [
                  0,
                  -size.h *
                  (currentFlow.expanded
                    ? 0.4
                    : 0.3),
                ]
                : [-210, 0],
              duration: 350,
            }
          );
          return;
        }

        /**
                 * Fallback schematic map.
                 */
        const scale = Math.max(size.w / 1250, size.h / 1200);
        const [x, y] = project(node);
        setOffset(
          {
            x: size.w *
              (mobile ? 0.5 : 0.4) -
              (size.w - 1250 * scale) / 2 -
              x * scale * zoom,
            y: size.h *
              (mobile ? 0.22 : 0.47) -
              (size.h - 1200 * scale) / 2 -
              y * scale * zoom,
          }
        );
      },
      [
        size,
        project,
        zoom,
        loaded,
      ]
    );
    /**
     * Fit all visible FLOW nodes.
     */
    const fit = useCallback(
      () => {
        setZoom(1);
        setOffset({
          x: 0,
          y: 0,
        });
        const currentFlow = latest.current;
        if (map.current &&
          mapModule.current &&
          currentFlow.visibleNodes.length) {
          const bounds = new mapModule.current.LngLatBounds();
          currentFlow.visibleNodes.forEach((node) => {
            bounds.extend([
              node.longitude,
              node.latitude,
            ]);
          });
          map.current.fitBounds(bounds, {
            padding: {
              top: 100,
              bottom: currentFlow.selectedId &&
                window.innerWidth <= 760
                ? size.h * 0.64
                : 80,
              left: 50,
              right: currentFlow.selectedId &&
                window.innerWidth > 760
                ? 500
                : 50,
            },
            maxZoom: 14.5,
            duration: 350,
          });
        }
      },
      [size.h]
    );
    /**
     * Zoom controls.
     */
    const zoomBy = useCallback(
      (delta: number) => {
        if (map.current && loaded) {
          map.current.zoomTo(map.current.getZoom() + delta);
          return;
        }

        setZoom(
          (currentZoom) => {
            const nextZoom = Math.max(0.5, Math.min(4, currentZoom *
              (delta > 0 ? 1.2 : 1 / 1.2)));
            const scale = Math.max(size.w / 1250, size.h / 1200);
            const baseX = (size.w - 1250 * scale) / 2;
            const baseY = (size.h - 1200 * scale) / 2;
            setOffset(
              (currentOffset) => ({
                x: size.w / 2 -
                  baseX -
                  ((size.w / 2 -
                    baseX -
                    currentOffset.x) *
                    nextZoom) /
                  currentZoom,
                y: size.h / 2 -
                  baseY -
                  ((size.h / 2 -
                    baseY -
                    currentOffset.y) *
                    nextZoom) /
                  currentZoom,
              })
            );
            return nextZoom;
          }
        );
      },
      [
        loaded,
        size,
      ]
    );

    useImperativeHandle(
      ref,
      () => ({
        focus,
        fit,
        zoomBy,
        locate(latitude, longitude, accuracy) {
          setUser({
            latitude,
            longitude,
            accuracy,
          });
          if (map.current &&
            mapModule.current &&
            loaded) {
            map.current.easeTo({
              center: [
                longitude,
                latitude,
              ],
              zoom: 15,
            });

            userMarker.current?.remove();
            const element = document.createElement('div');
            element.className = 'user-dot';
            element.title =
              `Your location ±${Math.round(accuracy)} m`;
            userMarker.current =
              new mapModule.current.Marker({
                element,
              })
                .setLngLat([
                  longitude,
                  latitude,
                ])

                .addTo(map.current);
            return;
          }

          const scale = Math.max(size.w / 1250, size.h / 1200);
          const [x, y] = project({
            latitude,
            longitude,
          });
          setOffset(
            {
              x: size.w / 2 -
                (size.w -
                  1250 * scale) /
                2 -
                x * scale * zoom,
              y: size.h / 2 -
                (size.h -
                  1200 * scale) /
                2 -
                y * scale * zoom,
            }
          );
        },
      }),
      [
        focus,
        fit,
        zoomBy,
        loaded,
        size,
        project,
        zoom,
      ]
    );

    /**
         * Keep MapLibre sized correctly.
         */
    useEffect(
      () => {
        if (!container.current)
          return;

        const element = container.current;
        const observer = new ResizeObserver(
          ([entry]) => {
            setSize({
              w: entry.contentRect.width,
              h: entry.contentRect.height,
            });
            map.current?.resize();
          }
        );
        observer.observe(element);
        return () => observer.disconnect();
      },
      []
    );

    /**
         * Create MapLibre map.
         */
    useEffect(
      () => {
        let cancelled = false;
        let created: LibreMap | null = null;
        void import('maplibre-gl')

          .then(
            (lib) => {
              if (cancelled ||
                !container.current) {
                return;
              }

              mapModule.current = lib;
              created = new lib.Map(
                {
                  container: container.current,
                  style: config[latest.current.theme ===
                    'light'
                    ? 'mapStyleLight'
                    : 'mapStyleDark'],
                  center: [
                    121.032,
                    14.577,
                  ],
                  zoom: 14,
                  minZoom: 3,
                  maxZoom: 19,
                  /**
                   * Important:
                   * disable MapLibre's default
                   * attribution UI.
                   */
                  attributionControl: false,
                }
              );
              /**
               * DO NOT add an AttributionControl here.
               *
               * The previous version had:
               *
               * created.addControl(
               *   new lib.AttributionControl({
               *     compact: true,
               *   }),
               *   'bottom-right'
               * );
               *
               * It has been intentionally removed.
               */
              map.current = created;
              created.on('load', () => {
                if (cancelled)
                  return;

                setLoaded(true);
                setMapError(false);
              });
              created.on('error', () => {
                if (!cancelled) {
                  setMapError(true);
                }
              });
              /**
               * Installer coordinate picker.
               */
              created.on('click', (event) => {
                const currentFlow = latest.current;
                if (currentFlow.picking) {
                  currentFlow.setEditing(
                    {
                      ...currentFlow.picking,
                      latitude: Number(event.lngLat.lat.toFixed(6)),
                      longitude: Number(event.lngLat.lng.toFixed(6)),
                    }
                  );
                  currentFlow.setPicking(null);
                  currentFlow.setModal('node-form');
                }
              });
            }
          )

          .catch(() => {
            if (!cancelled) {
              setMapError(true);
            }
          });
        return () => {
          cancelled = true;
          markers.current.forEach((marker) => marker.remove());
          markers.current.clear();
          created?.remove();
          map.current = null;
        };
      },
      []
    );

    /**
         * Switch light/dark map style.
         */
    useEffect(
      () => {
        if (map.current &&
          loaded) {
          map.current.setStyle(config[flow.theme === 'light'
            ? 'mapStyleLight'
            : 'mapStyleDark']);
        }
      },
      [
        flow.theme,
        loaded,
      ]
    );

    /**
         * Synchronize FLOW nodes with
         * MapLibre markers.
         */
    useEffect(
      () => {
        if (!loaded ||
          !map.current ||
          !mapModule.current) {
          return;
        }

        const list: {
          id: string;
          element: HTMLElement;
        }[] = [];
        const active = new Set(flow.visibleNodes.map((node) => node.id));
        /**
         * Remove markers that are
         * no longer visible.
         */
        for (const [id, marker] of markers.current) {
          if (!active.has(id)) {
            marker.remove();
            markers.current.delete(id);
          }
        }

        /**
                 * Add/update current markers.
                 */
        for (const node of flow.visibleNodes) {
          let marker = markers.current.get(node.id);
          if (!marker) {
            const element = document.createElement('div');
            marker =
              new mapModule.current.Marker({
                element,
              })
                .setLngLat([
                  node.longitude,
                  node.latitude,
                ])

                .addTo(map.current);
            markers.current.set(node.id, marker);
          }

          marker.setLngLat([
            node.longitude,
            node.latitude,
          ]);
          list.push({
            id: node.id,
            element: marker.getElement(),
          });
        }

        setHosts(list);
      },
      [
        loaded,
        flow.visibleNodes,
      ]
    );

    /**
         * Focus selected node.
         */
    useEffect(
      () => {
        if (flow.selectedId) {
          focus(flow.selectedId);
        }
        else if (loaded) {
          fit();
        }
      },
      [
        flow.selectedId,
        flow.expanded,
        loaded,
        focus,
        fit,
      ]
    );

    /**
         * Fallback-map mouse-wheel zoom.
         */
    useEffect(
      () => {
        if (loaded ||
          !container.current) {
          return;
        }

        const element = container.current.parentElement;
        if (!element)
          return;

        const handleWheel = (event: WheelEvent) => {
          if ((event.target as HTMLElement).closest('.details, .search-dock, .sidebar, .map-controls')) {
            return;
          }

          event.preventDefault();
          zoomBy(event.deltaY < 0
            ? 1
            : -1);
        };
        element.addEventListener('wheel', handleWheel, {
          passive: false,
        });
        return () => {
          element.removeEventListener('wheel', handleWheel);
        };
      },
      [
        loaded,
        zoomBy,
      ]
    );

    /**
         * React representation of
         * one FLOW monitoring marker.
         */
    function marker(node: FlowNode) {
      const status = flow.getStatus(node);
      return (<button
        className={'map-node' +
          (flow.selectedId ===
            node.id
            ? ' selected'
            : '')}
        style={{
          '--status-color': status.color,
        } as CSSProperties}
        data-unavailable={status.level === null}
        aria-label={`${node.name}: ${status.label}. Open details.`}
        aria-pressed={flow.selectedId ===
          node.id}
        onClick={
          (event) => {
            event.stopPropagation();
            if (!flow.picking) {
              flow.selectNode(node.id);
            }
          }
        }
      >
        <span className="marker-label">
          {node.name}
        </span>
        <span className="pin-ring" />
      </button>);
    }

    return (<>
      {/* Real geographic map */}
      <div
        ref={container}
        id="map"
        aria-label="Geographic monitoring map"
      />
      {/* Fallback when MapLibre cannot load */}
      {!loaded
        && (<div
          className="fallback-map"
          aria-label="Geographic basemap unavailable"
          onPointerDown={
            (event) => {
              if ((event.target as HTMLElement).closest('button')) {
                return;
              }

              drag.current = {
                x: event.clientX,
                y: event.clientY,
                ox: offset.x,
                oy: offset.y,
                didMove: false,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }
          onPointerMove={
            (event) => {
              if (!drag.current) {
                return;
              }

              const dx = event.clientX -
                drag.current.x;
              const dy = event.clientY -
                drag.current.y;
              if (Math.abs(dx) +
                Math.abs(dy) >
                4) {
                drag.current.didMove =
                  true;
              }

              setOffset({
                x: drag.current.ox +
                  dx,
                y: drag.current.oy +
                  dy,
              });
            }
          }
          onPointerUp={
            (event) => {
              if (drag.current &&
                !drag.current
                  .didMove &&
                flow.picking) {
                const rect = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX -
                  rect.left -
                  geometry.x) /
                  geometry.scale /
                  zoom;
                const y = (event.clientY -
                  rect.top -
                  geometry.y) /
                  geometry.scale /
                  zoom;
                flow.setEditing(
                  {
                    ...flow.picking,
                    latitude: Number((bounds.maxLat -
                      (y / 1200) *
                      bounds.spanLat).toFixed(6)),
                    longitude: Number((bounds.minLon +
                      (x / 1250) *
                      bounds.spanLon).toFixed(6)),
                  }
                );
                flow.setPicking(null);
                flow.setModal('node-form');
              }

              drag.current = null;
            }
          }
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <svg
            className="basemap"
            viewBox={`0 0 ${size.w} ${size.h}`}
            aria-hidden="true"
          >
            <rect
              width={size.w}
              height={size.h}
              fill={flow.theme ===
                'light'
                ? '#f5f5f0'
                : '#152637'}
            />
          </svg>
          <div className="fallback-nodes">
            {flow.visibleNodes.map(
              (node) => {
                const [x, y] = project(node);
                return (<div
                  className="fallback-node"
                  key={node.id}
                  style={
                    {
                      left: geometry.x +
                        x *
                        geometry.scale *
                        zoom,
                      top: geometry.y +
                        y *
                        geometry.scale *
                        zoom,
                    }
                  }
                >
                  {marker(node)}
                </div>);
              }
            )}
            {user
              &&
              (() => {
                const [x, y] = project(user);
                return (<div
                  className="user-dot fallback-node"
                  style={
                    {
                      left: geometry.x +
                        x *
                        geometry.scale *
                        zoom,
                      top: geometry.y +
                        y *
                        geometry.scale *
                        zoom,
                    }
                  }
                  title={`Your location ±${Math.round(user.accuracy)} m`}
                />);
              })()}
          </div>
        </div>)}
      {/* React markers rendered inside MapLibre */}
      {loaded
        &&
        hosts.map(
          ({ id, element, }) => {
            const node = flow.nodes.find((item) => item.id === id);
            return node
              ? createPortal(marker(node), element, id)
              : null;
          }
        )}
      {/*
          No MapLibre attribution control
          is rendered here.
        */}
    </>);
  }
);
