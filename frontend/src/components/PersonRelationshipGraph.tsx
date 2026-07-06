import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { alpha } from "@mui/material/styles";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Slider,
  Typography,
  useTheme,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  EdgeEvent,
  Graph as G6Graph,
  GraphData,
  NodeEvent,
  type IElementEvent,
} from "@antv/g6";
import type { BaseEdgeStyleProps, BaseNodeStyleProps } from "@antv/g6";
import useResizeObserver from "use-resize-observer";
import { API } from "../config";
import { encodeFilePath } from "../urlUtils";
import { PersonRelationshipGraph as PersonRelationshipGraphData } from "../types";
interface PersonRelationshipGraphProps {
  graph: PersonRelationshipGraphData | null;
  depth: number;
  isLoading: boolean;
  onDepthChange: (depth: number) => void;
}

interface WeightSummary {
  min: number;
  max: number;
}

type GraphNode = {
  id: string;
  depth: number;
  totalWeight: number;
  bridgeScore: number;
  cluster?: string;
  clusterColor?: string;
  image?: string | null;
  isRoot: boolean;
  size: number;
  x?: number;
  y?: number;
  style: Partial<BaseNodeStyleProps>;
  data: {
    personId: string;
    name: string;
    depth: number;
    totalWeight: number;
    hasImage: boolean;
  };
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  weight: number;
  normalizedWeight: number;
  visualWidth: number;
  layoutWeight: number;
  intensity: number;
  formattedLabel: string;
  label?: string;
  style: Partial<BaseEdgeStyleProps>;
  data: {
    weight: number;
    normalizedWeight: number;
    layoutWeight: number;
    formattedLabel: string;
    isInterCluster: boolean;
  };
};

interface ClusterSummary {
  id: string;
  color: string;
  nodeIds: string[];
  totalWeight: number;
  hasRoot: boolean;
  bridgeCount: number;
}

interface ClusteredGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: ClusterSummary[];
}

const CLUSTER_COLORS = [
  "#5B8FF9",
  "#61DDAA",
  "#65789B",
  "#F6BD16",
  "#7262FD",
  "#78D3F8",
  "#9661BC",
  "#F6903D",
  "#008685",
  "#F08BB4",
];

const MIN_SPACING = 90;
const MAX_SPACING = 260;
const DENSE_NODE_THRESHOLD = 160;
const DENSE_EDGE_THRESHOLD = 240;
const HIGH_LAYOUT_NODE_THRESHOLD = 180;

const clampForceSpacing = (value: number) =>
  Math.max(MIN_SPACING, Math.min(MAX_SPACING, value));

const normalizeWeight = (weight: number, summary: WeightSummary) => {
  if (summary.max === summary.min) {
    return 1;
  }
  return (weight - summary.min) / (summary.max - summary.min);
};

const rgbToHex = (r: number, g: number, b: number) => {
  const toHex = (value: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const hexToRgb = (hex: string) => {
  const sanitized = hex.replace("#", "");
  if (sanitized.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(sanitized.slice(0, 2), 16),
    g: parseInt(sanitized.slice(2, 4), 16),
    b: parseInt(sanitized.slice(4, 6), 16),
  };
};

const interpolateHexColor = (from: string, to: string, amount: number) => {
  const clamped = Math.max(0, Math.min(1, amount));
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const r = start.r + (end.r - start.r) * clamped;
  const g = start.g + (end.g - start.g) * clamped;
  const b = start.b + (end.b - start.b) * clamped;
  return rgbToHex(r, g, b);
};

const clampSliderValue = (value: number | number[]) =>
  Array.isArray(value) ? value[0] : value;

const pseudoRandom = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const clearElementStates = (graph: G6Graph) => {
  graph.getNodeData().forEach((node) => {
    void graph.setElementState(node.id, []);
  });
  graph.getEdgeData().forEach((edge) => {
    void graph.setElementState(edge.id, []);
  });
};

const applyWeightedSpringLayout = (
  clustered: ClusteredGraph,
  baseSpacing: number
): GraphData => {
  const spacing = clampForceSpacing(baseSpacing);
  const nodes = clustered.nodes.map((node) => ({
    ...node,
    style: { ...(node.style ?? {}) },
  }));
  const edges = clustered.edges.map((edge) => ({
    ...edge,
    style: { ...(edge.style ?? {}) },
  }));

  const nodeCount = nodes.length;
  if (nodeCount === 0) {
    return { nodes, edges };
  }

  const initialRadius = spacing * Math.max(1.4, Math.sqrt(nodeCount) * 0.55);
  nodes.forEach((node, index) => {
    const angle = (index / nodeCount) * Math.PI * 2;
    node.style.x = Math.cos(angle) * initialRadius;
    node.style.y = Math.sin(angle) * initialRadius;
  });

  const radii = nodes.map((node) => {
    const styleSize = node.style?.size;
    const numericSize =
      typeof styleSize === "number" ? styleSize : node.size ?? 40;
    return Math.max(16, numericSize / 2);
  });

  const indexMap = new Map<string, number>();
  nodes.forEach((node, index) => {
    indexMap.set(node.id, index);
  });

  const sqrtCount = Math.sqrt(nodeCount);
  const areaEdge = spacing * Math.max(2.2, sqrtCount * 0.9);
  const idealArea = Math.pow(areaEdge, 2);
  const k = Math.sqrt(idealArea / nodeCount);

  const highDensityLayout = nodeCount >= HIGH_LAYOUT_NODE_THRESHOLD;
  let temperature = spacing * Math.max(
    highDensityLayout ? 2.1 : 2.6,
    sqrtCount * (highDensityLayout ? 1.18 : 1.6)
  );
  const iterations = highDensityLayout
    ? Math.min(120, Math.max(48, Math.round(nodeCount * 2.4)))
    : Math.min(160, Math.max(60, Math.round(nodeCount * 4)));
  const coolingFactor = highDensityLayout ? 0.88 : 0.92;
  const displacements = nodes.map(() => ({ x: 0, y: 0 }));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    displacements.forEach((disp) => {
      disp.x = 0;
      disp.y = 0;
    });

    for (let i = 0; i < nodeCount; i += 1) {
      for (let j = i + 1; j < nodeCount; j += 1) {
        let dx = (nodes[i].style.x ?? 0) - (nodes[j].style.x ?? 0);
        let dy = (nodes[i].style.y ?? 0) - (nodes[j].style.y ?? 0);
        let distSq = dx * dx + dy * dy;
        if (distSq < 1e-6) {
          const jitter = 0.01;
          const seed = iteration * nodeCount * 13 + i * 7 + j * 17;
          dx = (pseudoRandom(seed) - 0.5) * jitter;
          dy = (pseudoRandom(seed + 1) - 0.5) * jitter;
          distSq = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(distSq);
        const minSep = radii[i] + radii[j] + spacing * 0.18;

        const repulsiveStrength = highDensityLayout ? 0.62 : 0.75;
        let repulsive = ((k * k) / dist) * repulsiveStrength;
        if (dist < minSep) {
          const overlapPush = highDensityLayout ? 1.2 : 1.6;
          repulsive += ((minSep - dist) / minSep) * k * overlapPush;
        }

        const fx = (dx / dist) * repulsive;
        const fy = (dy / dist) * repulsive;
        displacements[i].x += fx;
        displacements[i].y += fy;
        displacements[j].x -= fx;
        displacements[j].y -= fy;
      }
    }

    edges.forEach((edge, edgeIndex) => {
      const sourceIndex = indexMap.get(edge.source);
      const targetIndex = indexMap.get(edge.target);
      if (sourceIndex === undefined || targetIndex === undefined) {
        return;
      }

      let dx =
        (nodes[sourceIndex].style.x ?? 0) -
        (nodes[targetIndex].style.x ?? 0);
      let dy =
        (nodes[sourceIndex].style.y ?? 0) -
        (nodes[targetIndex].style.y ?? 0);
      let distSq = dx * dx + dy * dy;
      if (distSq < 1e-6) {
        const jitter = 0.05;
        const offset = edgeIndex * 0.37;
        dx = Math.cos(offset) * jitter;
        dy = Math.sin(offset) * jitter;
        distSq = dx * dx + dy * dy;
      }
      const dist = Math.sqrt(distSq);
      const weight = Math.max(
        0,
        Math.min(1, edge.layoutWeight ?? edge.normalizedWeight ?? 0)
      );
      const desired =
        radii[sourceIndex] +
        radii[targetIndex] +
        spacing * (0.18 + (1 - weight) * 1.1);
      const diff = dist - desired;
      const adjustedStrength = 0.28 + weight * (highDensityLayout ? 0.85 : 1.1);
      const force =
        (diff / (desired + 1e-6)) * (k * adjustedStrength);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      displacements[sourceIndex].x -= fx;
      displacements[sourceIndex].y -= fy;
      displacements[targetIndex].x += fx;
      displacements[targetIndex].y += fy;
    });

    for (let i = 0; i < nodeCount; i += 1) {
      const disp = displacements[i];
      const dispLength = Math.hypot(disp.x, disp.y);
      if (dispLength < 1e-6) {
        continue;
      }
      const limited = Math.min(dispLength, temperature);
      nodes[i].style.x =
        (nodes[i].style.x ?? 0) + (disp.x / dispLength) * limited;
      nodes[i].style.y =
        (nodes[i].style.y ?? 0) + (disp.y / dispLength) * limited;
    }

    temperature *= coolingFactor;
  }

  const averageX =
    nodes.reduce((sum, node) => sum + (node.style.x ?? 0), 0) / nodeCount;
  const averageY =
    nodes.reduce((sum, node) => sum + (node.style.y ?? 0), 0) / nodeCount;
  let maxDistance = 0;

  nodes.forEach((node) => {
    const normalizedX = (node.style.x ?? 0) - averageX;
    const normalizedY = (node.style.y ?? 0) - averageY;
    const distance = Math.hypot(normalizedX, normalizedY);
    maxDistance = Math.max(maxDistance, distance);
    node.style = {
      ...node.style,
      x: normalizedX,
      y: normalizedY,
    };
    node.x = normalizedX;
    node.y = normalizedY;
  });

  const maxAllowedRadius =
    spacing * Math.max(2.8, Math.sqrt(nodeCount) * 1.3);
  if (maxDistance > maxAllowedRadius && maxDistance > 0) {
    const scale = maxAllowedRadius / maxDistance;
    nodes.forEach((node) => {
      node.style = {
        ...node.style,
        x: (node.style.x ?? 0) * scale,
        y: (node.style.y ?? 0) * scale,
      };
      node.x = (node.x ?? 0) * scale;
      node.y = (node.y ?? 0) * scale;
    });
  }

  return { nodes, edges };
};

const getEventElementId = (event: IElementEvent): string | undefined => {
  const target = event.target as { id?: string } | null;
  if (target?.id) {
    return String(target.id);
  }
  const eventWithData = event as unknown as { data?: { id?: string | number } };
  const dataId = eventWithData.data?.id;
  if (typeof dataId === "string" || typeof dataId === "number") {
    return String(dataId);
  }
  return undefined;
};

const highlightNode = (graph: G6Graph, nodeId: string) => {
  clearElementStates(graph);
  const edges = graph.getEdgeData() as GraphEdge[];
  const highlightedNodeIds = new Set<string>([nodeId]);
  const highlightedEdgeIds = new Set<string>();

  void graph.setElementState(nodeId, ["highlight"]);

  edges.forEach((edge) => {
    if (edge.source === nodeId || edge.target === nodeId) {
      highlightedEdgeIds.add(edge.id);
      highlightedNodeIds.add(edge.source);
      highlightedNodeIds.add(edge.target);
      void graph.setElementState(edge.id, ["highlight"]);
    }
  });

  edges.forEach((edge) => {
    if (!highlightedEdgeIds.has(edge.id)) {
      void graph.setElementState(edge.id, ["inactive"]);
    }
  });

  graph.getNodeData().forEach((node) => {
    if (!highlightedNodeIds.has(node.id)) {
      void graph.setElementState(node.id, ["inactive"]);
    }
  });
};

const highlightEdge = (graph: G6Graph, edgeId: string) => {
  const edge = graph.getEdgeData(edgeId) as GraphEdge | undefined;
  if (!edge) {
    return;
  }
  clearElementStates(graph);

  const involvedNodeIds = new Set<string>([edge.source, edge.target]);
  void graph.setElementState(edgeId, ["highlight"]);
  involvedNodeIds.forEach((id) => {
    void graph.setElementState(id, ["highlight"]);
  });

  graph.getEdgeData().forEach((edgeData) => {
    if (edgeData.id !== edgeId) {
      void graph.setElementState(edgeData.id, ["inactive"]);
    }
  });

  graph.getNodeData().forEach((nodeData) => {
    if (!involvedNodeIds.has(nodeData.id)) {
      void graph.setElementState(nodeData.id, ["inactive"]);
    }
  });
};

const sharedNeighborCount = (
  nodeIdA: string,
  nodeIdB: string,
  adjacencySets: Map<string, Set<string>>,
  depthLookup: Map<string, number>
) => {
  const neighborsA = adjacencySets.get(nodeIdA);
  const neighborsB = adjacencySets.get(nodeIdB);
  if (
    !neighborsA ||
    !neighborsB ||
    neighborsA.size === 0 ||
    neighborsB.size === 0
  ) {
    return 0;
  }
  const smaller = neighborsA.size < neighborsB.size ? neighborsA : neighborsB;
  const larger = smaller === neighborsA ? neighborsB : neighborsA;
  let count = 0;
  smaller.forEach((neighbor) => {
    if (larger.has(neighbor) && (depthLookup.get(neighbor) ?? 1) > 0) {
      count += 1;
    }
  });
  return count;
};

const applyClustering = (
  data: GraphData,
  palette: string[]
): ClusteredGraph => {
  const nodes: GraphNode[] = ((data.nodes ?? []) as GraphNode[]).map(
    (node) => ({
      ...node,
      style: { ...(node.style ?? {}) },
    })
  );
  const edges: GraphEdge[] = ((data.edges ?? []) as GraphEdge[]).map(
    (edge) => ({
      ...edge,
      style: { ...(edge.style ?? {}) },
    })
  );
  const denseGraph =
    nodes.length >= DENSE_NODE_THRESHOLD ||
    edges.length >= DENSE_EDGE_THRESHOLD;

  if (!nodes.length) {
    return { nodes, edges, clusters: [] };
  }

  const nodeLookup = new Map<string, GraphNode>();
  const depthLookup = new Map<string, number>();
  nodes.forEach((node) => {
    nodeLookup.set(node.id, node);
    depthLookup.set(node.id, node.depth ?? 1);
  });

  type NodeMetrics = {
    degree: number;
    totalNormalized: number;
    maxNormalized: number;
    strongestNeighbor?: string;
  };

  const adjacency = new Map<string, Map<string, number>>();
  const adjacencySets = new Map<string, Set<string>>();
  const adjacencyNormalized = new Map<string, Map<string, number>>();
  const nodeMetrics = new Map<string, NodeMetrics>();

  const ensureMetrics = (nodeId: string): NodeMetrics => {
    let metrics = nodeMetrics.get(nodeId);
    if (!metrics) {
      metrics = { degree: 0, totalNormalized: 0, maxNormalized: 0 };
      nodeMetrics.set(nodeId, metrics);
    }
    return metrics;
  };

  const updateMetrics = (
    nodeId: string,
    neighborId: string,
    normalized: number
  ) => {
    const metrics = ensureMetrics(nodeId);
    metrics.degree += 1;
    metrics.totalNormalized += normalized;
    if (normalized >= metrics.maxNormalized) {
      metrics.maxNormalized = normalized;
      metrics.strongestNeighbor = neighborId;
    }
  };

  nodes.forEach((node) => {
    adjacency.set(node.id, new Map());
    adjacencySets.set(node.id, new Set());
    adjacencyNormalized.set(node.id, new Map());
  });

  edges.forEach((edge) => {
    const weight = edge.weight ?? 1;
    const normalized = Math.max(
      0,
      Math.min(1, edge.layoutWeight ?? edge.normalizedWeight ?? 0)
    );
    adjacency.get(edge.source)?.set(edge.target, weight);
    adjacency.get(edge.target)?.set(edge.source, weight);
    adjacencySets.get(edge.source)?.add(edge.target);
    adjacencySets.get(edge.target)?.add(edge.source);
    adjacencyNormalized.get(edge.source)?.set(edge.target, normalized);
    adjacencyNormalized.get(edge.target)?.set(edge.source, normalized);
    updateMetrics(edge.source, edge.target, normalized);
    updateMetrics(edge.target, edge.source, normalized);
  });

  const labels = new Map<string, string>();
  nodes.forEach((node) => {
    labels.set(node.id, node.id);
  });

  const rootIds = nodes
    .filter((node) => node.depth === 0)
    .map((node) => node.id);
  const rootSet = new Set(rootIds);

  const iterations = Math.max(
    4,
    Math.min(12, Math.ceil(Math.sqrt(nodes.length)))
  );
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const clusterCounts = new Map<string, number>();
    labels.forEach((label) => {
      clusterCounts.set(label, (clusterCounts.get(label) ?? 0) + 1);
    });

    let changed = false;
    nodes.forEach((node) => {
      const neighbors = adjacency.get(node.id);
      if (!neighbors || !neighbors.size) {
        return;
      }

      const currentLabel = labels.get(node.id) ?? node.id;
      let bestLabel = currentLabel;
      let bestScore = -Infinity;

      neighbors.forEach((weight, neighborId) => {
        const neighborLabel = labels.get(neighborId) ?? neighborId;
        const neighborNode = nodeLookup.get(neighborId);
        if (!neighborNode) {
          return;
        }

        const normalized =
          adjacencyNormalized.get(node.id)?.get(neighborId) ?? 0;

        let influence =
          weight *
          (0.24 + Math.pow(Math.max(normalized, 0), 1.6) * 2.6);
        if (rootSet.has(node.id) || rootSet.has(neighborId)) {
          influence *= 0.25;
        }

        const neighborDegree = Math.max(
          1,
          adjacencySets.get(neighborId)?.size ?? 1
        );
        const degreeDamping = 1 / Math.log2(neighborDegree + 1.5);

        const shared = sharedNeighborCount(
          node.id,
          neighborId,
          adjacencySets,
          depthLookup
        );
        const similarityBoost = 1 + shared * 0.55;

        const compositeScore = influence * similarityBoost * degreeDamping;
        const neighborClusterSize = clusterCounts.get(neighborLabel) ?? 1;
        const bestClusterSize = clusterCounts.get(bestLabel) ?? 1;

        if (
          compositeScore > bestScore ||
          (Math.abs(compositeScore - bestScore) < 1e-6 &&
            neighborClusterSize > bestClusterSize) ||
          (Math.abs(compositeScore - bestScore) < 1e-6 &&
            neighborClusterSize === bestClusterSize &&
            neighborLabel < bestLabel)
        ) {
          bestScore = compositeScore;
          bestLabel = neighborLabel;
        }
      });

      if (bestLabel !== currentLabel) {
        labels.set(node.id, bestLabel);
        changed = true;
      }
    });

    if (!changed) {
      break;
    }
  }

  nodes.forEach((node) => {
    if (rootSet.has(node.id)) {
      return;
    }
    const metrics = nodeMetrics.get(node.id);
    if (!metrics) {
      return;
    }
    if (metrics.degree <= 1 && metrics.maxNormalized <= 0.22) {
      labels.set(node.id, node.id);
      return;
    }
    if (
      metrics.degree <= 2 &&
      metrics.maxNormalized <= 0.18 &&
      metrics.totalNormalized <= 0.38
    ) {
      labels.set(node.id, node.id);
    }
  });

  const labelToCluster = new Map<string, { id: string; color: string }>();
  const labelCounts = new Map<string, number>();
  labels.forEach((label) => {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  });

  const sortedLabels = Array.from(labelCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label);

  sortedLabels.forEach((label, index) => {
    const clusterId = `cluster-${index}`;
    labelToCluster.set(label, {
      id: clusterId,
      color: CLUSTER_COLORS[index % CLUSTER_COLORS.length],
    });
  });

  const clusterSummaries = new Map<string, ClusterSummary>();
  const backgroundColor = "#0B1224";
  nodes.forEach((node) => {
    const label = labels.get(node.id);
    const cluster = label ? labelToCluster.get(label) : undefined;
    if (cluster) {
      node.cluster = cluster.id;
      node.clusterColor = cluster.color;
    }

    const summary = clusterSummaries.get(cluster?.id ?? node.id) ?? {
      id: cluster?.id ?? node.id,
      color: cluster?.color ?? alpha("#5B8FF9", 0.9),
      nodeIds: [],
      totalWeight: 0,
      hasRoot: false,
      bridgeCount: 0,
    };

    summary.nodeIds.push(node.id);
    summary.totalWeight += node.totalWeight ?? 0;
    summary.hasRoot = summary.hasRoot || node.depth === 0;
    clusterSummaries.set(summary.id, summary);
  });

  const bridgingMap = new Map<string, Set<string>>();
  nodes.forEach((node) => {
    bridgingMap.set(node.id, new Set());
  });

  edges.forEach((edge) => {
    const sourceNode = nodeLookup.get(edge.source);
    const targetNode = nodeLookup.get(edge.target);
    if (!sourceNode || !targetNode) {
      return;
    }
    const isInterCluster = sourceNode.cluster !== targetNode.cluster;
    const normalized = Math.max(
      0,
      Math.min(1, edge.normalizedWeight ?? 0)
    );
    edge.data = {
      ...edge.data,
      isInterCluster,
    };

    const baseStroke = (edge.style?.stroke as string | undefined) ?? "#6C7A99";
    if (isInterCluster) {
      bridgingMap.get(edge.source)?.add(targetNode.cluster ?? "");
      bridgingMap.get(edge.target)?.add(sourceNode.cluster ?? "");
      const sourceSummary = sourceNode.cluster
        ? clusterSummaries.get(sourceNode.cluster)
        : undefined;
      const targetSummary = targetNode.cluster
        ? clusterSummaries.get(targetNode.cluster)
        : undefined;
      if (sourceSummary) {
        sourceSummary.bridgeCount += 1;
      }
      if (targetSummary) {
        targetSummary.bridgeCount += 1;
      }
      edge.style = {
        ...edge.style,
        stroke: interpolateHexColor(baseStroke, "#9FA6BF", 0.6),
        lineWidth: Math.min(
          8,
          Math.max(
            1.2,
            (edge.visualWidth ?? 2) * (0.45 + normalized * 0.4)
          )
        ),
        opacity: Math.min(0.38, 0.12 + normalized * 0.32),
        lineDash: [4, 9],
        shadowColor: undefined,
        shadowBlur: 0,
        lineCap: "round",
        lineJoin: "round",
        cursor: "pointer",
      };
    } else {
      const clusterColor =
        sourceNode.clusterColor && sourceNode.clusterColor === targetNode.clusterColor
          ? sourceNode.clusterColor
          : sourceNode.clusterColor ?? targetNode.clusterColor;
      const strokeColor = clusterColor
        ? interpolateHexColor(
            baseStroke,
            clusterColor,
            Math.min(0.8, 0.35 + normalized * 0.45)
          )
        : baseStroke;
      edge.style = {
        ...edge.style,
        stroke: strokeColor,
        lineWidth: denseGraph
          ? Math.max(1.8, (edge.visualWidth ?? 2.2) * 0.8)
          : Math.max(2.2, edge.visualWidth ?? 2.2),
        opacity: denseGraph
          ? Math.max(0.18, Math.min(0.6, 0.12 + normalized * 0.4))
          : Math.max(edge.intensity ?? 0.08, 0.08 + normalized * 0.32),
        shadowColor: denseGraph
          ? alpha(strokeColor, Math.min(0.35, 0.18 + normalized * 0.28))
          : alpha(strokeColor, 0.3 + normalized * 0.45),
        shadowBlur: denseGraph
          ? edge.style?.shadowBlur ?? 0
          : Math.max(edge.style?.shadowBlur ?? 0, 12 + normalized * 8),
        lineDash: undefined,
        lineCap: "round",
        lineJoin: "round",
        cursor: "pointer",
      };
    }
  });

  nodes.forEach((node) => {
    node.bridgeScore = bridgingMap.get(node.id)?.size ?? 0;
    const clusterColor = node.clusterColor;
    if (clusterColor) {
      const fill = interpolateHexColor(
        backgroundColor,
        clusterColor,
        node.isRoot ? 0.6 : 0.45
      );
      const stroke = interpolateHexColor(backgroundColor, clusterColor, 0.92);
      const shadow = alpha(
        clusterColor,
        denseGraph ? (node.isRoot ? 0.45 : 0.35) : node.isRoot ? 0.6 : 0.45
      );
      const clusterShadowBlur = denseGraph
        ? node.isRoot
          ? 14
          : 8
        : node.isRoot
        ? 26
        : 16;
      node.style = {
        ...node.style,
        fill,
        stroke,
        lineWidth: Math.max(node.style?.lineWidth ?? 2, node.isRoot ? 3.6 : 2.4),
        shadowColor: shadow,
        shadowBlur: clusterShadowBlur,
      };
    }
    if (node.isRoot) {
      const rootShadowBlur = denseGraph ? 18 : 28;
      node.style = {
        ...node.style,
        stroke: "#FFFFFF",
        lineWidth: Math.max(node.style?.lineWidth ?? 0, 4),
        shadowColor: alpha("#FFFFFF", denseGraph ? 0.4 : 0.5),
        shadowBlur: rootShadowBlur,
      };
    }
  });

  const clusters = Array.from(clusterSummaries.values()).sort((a, b) => {
    if (a.hasRoot && !b.hasRoot) return -1;
    if (!a.hasRoot && b.hasRoot) return 1;
    return b.totalWeight - a.totalWeight;
  });

  return { nodes, edges, clusters };
};

const PersonRelationshipGraph: React.FC<PersonRelationshipGraphProps> = ({
  graph,
  depth,
  isLoading,
  onDepthChange,
}) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const g6GraphRef = useRef<G6Graph | null>(null);
  const {
    ref: resizeRef,
    width = 960,
    height = 560,
  } = useResizeObserver<HTMLDivElement>();

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const showEdgeLabelsRef = useRef(showEdgeLabels);
  showEdgeLabelsRef.current = showEdgeLabels;
  const [spacing, setSpacing] = useState(() => clampForceSpacing(140));
  const [minWeight, setMinWeight] = useState(1);
  const [spacingDraft, setSpacingDraft] = useState(spacing);
  const [minWeightDraft, setMinWeightDraft] = useState(minWeight);

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof resizeRef === "function") {
        resizeRef(node);
      } else if (resizeRef && "current" in resizeRef) {
        resizeRef.current = node;
      }
    },
    [resizeRef]
  );

  const weightSummary: WeightSummary = useMemo(() => {
    if (!graph || !graph.edges.length) {
      return { min: 1, max: 1 };
    }
    const weights = graph.edges
      .map((edge) => Math.max(1, Number(edge.weight) || 0))
      .filter((value) => Number.isFinite(value));
    const min = Math.max(1, Math.min(...weights));
    const max = Math.min(100, Math.max(...weights));
    return { min, max };
  }, [graph]);

  useEffect(() => {
    const clampToSummary = (current: number) => {
      const { min, max } = weightSummary;
      if (current < min) return min;
      if (current > max) return max;
      return current;
    };
    setMinWeight(clampToSummary);
    setMinWeightDraft(clampToSummary);
  }, [weightSummary]);

  const processedData: GraphData | undefined = useMemo(() => {
    if (!graph) {
      return undefined;
    }

    const nodeWeightMap = new Map<string, number>();
    const filteredEdgesRaw = graph.edges.filter(
      (edge) => (edge.weight ?? 0) >= minWeight
    );

    const nodeIdSet = new Set(graph.nodes.map((node) => String(node.id)));
    const adjacency = new Map<string, Set<string>>();

    filteredEdgesRaw.forEach((edge) => {
      const source = String(edge.source);
      const target = String(edge.target);
      if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) {
        return;
      }
      if (!adjacency.has(source)) {
        adjacency.set(source, new Set());
      }
      adjacency.get(source)!.add(target);
      if (!adjacency.has(target)) {
        adjacency.set(target, new Set());
      }
      adjacency.get(target)!.add(source);
    });

    const rootId = String(graph.root_id ?? graph.nodes[0]?.id ?? "");
    const reachable = new Set<string>();
    const queue: string[] = [rootId];

    while (queue.length) {
      const current = queue.shift();
      if (!current || !nodeIdSet.has(current) || reachable.has(current)) {
        continue;
      }
      reachable.add(current);
      const neighbors = adjacency.get(current);
      if (neighbors) {
        neighbors.forEach((neighbor) => {
          if (!reachable.has(neighbor)) {
            queue.push(neighbor);
          }
        });
      }
    }

    if (!reachable.size && nodeIdSet.has(rootId)) {
      reachable.add(rootId);
    }

    const connectedEdges = filteredEdgesRaw.filter((edge) => {
      const source = String(edge.source);
      const target = String(edge.target);
      return reachable.has(source) && reachable.has(target);
    });

    const activeNodeIds = new Set<string>();
    connectedEdges.forEach((edge) => {
      const weight = Math.max(1, Number(edge.weight) || 0);
      const source = String(edge.source);
      const target = String(edge.target);
      activeNodeIds.add(source);
      activeNodeIds.add(target);
      nodeWeightMap.set(source, (nodeWeightMap.get(source) ?? 0) + weight);
      nodeWeightMap.set(target, (nodeWeightMap.get(target) ?? 0) + weight);
    });

    const fallbackFill = alpha("#151B2C", 0.9);
    const labelColor =
      theme.palette.mode === "dark"
        ? theme.palette.grey[100]
        : theme.palette.grey[900];

    const nodes: GraphNode[] = graph.nodes
      .filter((node) => {
        const id = String(node.id);
        if (!reachable.has(id)) {
          return false;
        }
        return activeNodeIds.has(id);
      })
      .map((node) => {
        const id = String(node.id);
        const totalWeight = nodeWeightMap.get(id) ?? 0;
        const image = node.profile_thumbnail
          ? `${API}/thumbnails/${encodeFilePath(node.profile_thumbnail)}`
          : null;
      const baseSize = 32;
      const sizeBoost = Math.min(28, Math.sqrt(totalWeight || 1) * 4.2);
      const size = baseSize + sizeBoost + (node.depth === 0 ? 12 : 0);
      const personName = node.name ?? `Person ${node.id}`;
      const weightText = totalWeight ? `${totalWeight} shared` : "";
      const labelText = weightText
        ? `${personName}\n${weightText}`
        : personName;
      const isRoot = id === rootId;

      const style: Partial<BaseNodeStyleProps> = {
        size,
        fill: fallbackFill,
        stroke: isRoot ? "#ffffff" : alpha("#6C9EFF", 0.8),
        lineWidth: isRoot ? 3.6 : 1.8,
        shadowColor: alpha("#0D1321", 0.5),
        shadowBlur: 6,
        labelText,
        labelFontSize: weightText ? 11 : 11,
        labelFontWeight: node.depth === 0 ? 700 : 500,
        labelFill: labelColor,
        labelPlacement: "bottom",
        labelLineHeight: weightText ? 14 : 13,
        labelOffsetY: weightText ? 6 : 4,
        icon: Boolean(image),
        iconSrc: image ?? undefined,
        iconOpacity: image ? 1 : 0,
        iconWidth: size - 6,
        iconHeight: size - 6,
      };

      if (!image) {
        style.icon = false;
      } else {
        style.iconRadius = (size - 6) / 2;
      }

      return {
        ...node,
        id,
        depth: node.depth,
        totalWeight,
        bridgeScore: 0,
        cluster: undefined,
        clusterColor: undefined,
        image,
        isRoot,
        size,
        style,
        data: {
          personId: id,
          name: personName,
          depth: node.depth,
          totalWeight,
          hasImage: Boolean(image),
        },
      };
      });

    const denseGraph =
      nodes.length >= DENSE_NODE_THRESHOLD ||
      connectedEdges.length >= DENSE_EDGE_THRESHOLD;

    if (denseGraph) {
      nodes.forEach((node) => {
        const baseBlur = node.isRoot ? 8 : 4;
        node.style = {
          ...node.style,
          shadowBlur: Math.min(node.style?.shadowBlur ?? baseBlur, baseBlur),
        };
      });
    }

    const strongColor = theme.palette.primary.main;
    const weakColor =
      theme.palette.grey[700] ?? theme.palette.grey[500] ?? "#4C5A73";

    const edges: GraphEdge[] = connectedEdges.map((edge, index) => {
      const weight = Math.max(1, Number(edge.weight) || 0);
      const normalizedWeight = normalizeWeight(weight, weightSummary);
      const easedWeight = Math.pow(normalizedWeight, 0.55);
      const layoutWeight =
        normalizedWeight >= 0.5
          ? Math.min(1, normalizedWeight * 1.15)
          : normalizedWeight >= 0.3
          ? normalizedWeight
          : Math.pow(normalizedWeight, 1.8) * 0.1;
      const visualWidth =
        0.9 + easedWeight * 12 + Math.log2(weight + 1) * 1.1;
      const intensity = denseGraph
        ? 0.06 + Math.pow(normalizedWeight, 1.1) * 0.55
        : 0.04 + Math.pow(normalizedWeight, 1.25) * 0.96;
      const baseShadowBlur = denseGraph
        ? 0
        : Math.max(0, Math.round(visualWidth * 0.8));
      const lineAppendWidth = denseGraph
        ? Math.max(8, visualWidth + 6)
        : Math.max(10, visualWidth + 10);
      const color = interpolateHexColor(
        weakColor,
        strongColor,
        easedWeight
      );
      const formattedLabel = `${weight} co-appearance${
        weight === 1 ? "" : "s"
      }`;

      return {
        ...edge,
        id: `edge-${index}`,
        source: String(edge.source),
        target: String(edge.target),
        weight,
        normalizedWeight,
        layoutWeight,
        visualWidth,
        intensity,
        formattedLabel,
        label: showEdgeLabelsRef.current ? formattedLabel : "",
        style: {
          stroke: color,
          lineWidth: denseGraph
            ? Math.max(1.8, visualWidth * 0.88)
            : visualWidth,
          opacity: intensity,
          shadowColor: denseGraph ? undefined : alpha(color, 0.35),
          shadowBlur: baseShadowBlur,
          lineAppendWidth,
          lineCap: "round",
          lineJoin: "round",
          cursor: "pointer",
        },
        data: {
          weight,
          normalizedWeight,
          layoutWeight,
          formattedLabel,
          isInterCluster: false,
        },
      };
    });

    return { nodes, edges };
  }, [
    graph,
    minWeight,
    theme.palette.grey,
    theme.palette.primary,
    weightSummary,
  ]);

  const clusteredGraph: ClusteredGraph | undefined = useMemo(() => {
    if (!processedData) {
      return undefined;
    }
    return applyClustering(processedData, CLUSTER_COLORS);
  }, [processedData]);

  const graphData: GraphData | undefined = useMemo(() => {
    if (!clusteredGraph) {
      return undefined;
    }
    return applyWeightedSpringLayout(clusteredGraph, spacing);
  }, [clusteredGraph, spacing]);

  useEffect(() => {
    if (!containerRef.current || g6GraphRef.current) {
      return;
    }

    const graphInstance = new G6Graph({
      container: containerRef.current,
      width: sizeRef.current.width,
      height: sizeRef.current.height,
      pixelRatio: Math.min(2, window.devicePixelRatio * 1.1),
      behaviors: ["drag-element", "drag-canvas", "zoom-canvas", "scroll-canvas"],
      edge: {
        type: "quadratic",
        style: {
          stroke: alpha("#6C7A99", 0.4),
          lineWidth: 1.4,
          opacity: 0.4,
          lineAppendWidth: 8,
          lineCap: "round",
          lineJoin: "round",
        },
        label: {
          style: {
            fill: "#E8ECF3",
            fontSize: 10,
            fontWeight: 500,
            opacity: 0.9,
            background: {
              fill: alpha("#0D1321", 0.7),
              padding: [2, 4, 2, 4],
              radius: 4,
            },
          },
        },
        state: {
          highlight: {
            style: {
              opacity: 0.95,
              lineWidth: 4,
            },
          },
          inactive: {
            style: {
              opacity: 0.08,
            },
          },
        },
      },
      node: {
        type: "circle",
        state: {
          highlight: {
            style: {
              shadowBlur: 14,
              shadowColor: alpha(theme.palette.primary.main, 0.7),
              opacity: 1,
            },
          },
          inactive: {
            style: {
              opacity: 0.35,
            },
          },
        },
      },
    });

    graphInstance.on(NodeEvent.CLICK, (event: IElementEvent) => {
      const nodeId = getEventElementId(event);
      if (nodeId) {
        navigateRef.current(`/person/${nodeId}`);
      }
    });

    graphInstance.on(NodeEvent.POINTER_ENTER, (event: IElementEvent) => {
      const nodeId = getEventElementId(event);
      if (!nodeId) {
        return;
      }
      highlightNode(graphInstance, nodeId);
    });

    graphInstance.on(NodeEvent.POINTER_LEAVE, () => {
      clearElementStates(graphInstance);
    });

    graphInstance.on(EdgeEvent.POINTER_ENTER, (event: IElementEvent) => {
      const edgeId = getEventElementId(event);
      if (!edgeId) {
        return;
      }
      highlightEdge(graphInstance, edgeId);
    });

    graphInstance.on(EdgeEvent.POINTER_LEAVE, () => {
      clearElementStates(graphInstance);
    });

    g6GraphRef.current = graphInstance;

    return () => {
      graphInstance.destroy();
      g6GraphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const graphInstance = g6GraphRef.current;
    if (!graphInstance || !graphData) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      graphInstance.setData(graphData);
      await graphInstance.render();
      if (cancelled) {
        return;
      }
      await graphInstance.fitView({ padding: 48 });
    };

    run().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[PersonRelationshipGraph] Failed to render graph", error);
    });

    return () => {
      cancelled = true;
    };
  }, [graphData]);

  useEffect(() => {
    const graphInstance = g6GraphRef.current;
    if (!graphInstance) return;
    graphInstance.setSize(width, height);
    void graphInstance.fitView({ padding: 48 });
  }, [width, height]);

  useEffect(() => {
    const graphInstance = g6GraphRef.current;
    if (!graphInstance) return;
    const edges = graphInstance.getEdgeData() as GraphEdge[];
    if (!edges.length) return;
    graphInstance.updateEdgeData(
      edges.map((edge) => ({
        id: edge.id,
        label: showEdgeLabels ? edge.formattedLabel : "",
      }))
    );
    void graphInstance.draw();
  }, [showEdgeLabels]);

  const handleDepthChange = (event: SelectChangeEvent<string>) => {
    const nextDepth = Number(event.target.value);
    if (!Number.isNaN(nextDepth)) {
      onDepthChange(nextDepth);
    }
  };

  const handleResetView = () => {
    const graphInstance = g6GraphRef.current;
    if (!graphInstance) return;
    void graphInstance.fitView({ padding: 48 });
    clearElementStates(graphInstance);
  };

  const hasGraph = Boolean(
    graphData?.nodes?.length && graphData?.edges?.length
  );

  return (
    <Paper
      sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Box>
          <Typography variant="h6">Relationship Graph</Typography>
          <Typography variant="body2" color="text.secondary">
            Stronger shared-photo bonds render thicker, brighter edges. Hover to
            spotlight friendship bridges.
          </Typography>
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="relationship-depth-label">Generations</InputLabel>
            <Select
              labelId="relationship-depth-label"
              label="Generations"
              value={depth.toString()}
              onChange={handleDepthChange}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <MenuItem key={value} value={value.toString()}>
                  {value}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={showEdgeLabels}
                onChange={(event) => setShowEdgeLabels(event.target.checked)}
              />
            }
            label="Show edge weights"
          />
          <Box sx={{ width: 220 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              Force link distance: {spacingDraft}px
            </Typography>
            <Slider
              size="small"
              min={MIN_SPACING}
              max={MAX_SPACING}
              step={10}
              value={spacingDraft}
              valueLabelDisplay="auto"
              onChange={(_, value) =>
                setSpacingDraft(clampForceSpacing(clampSliderValue(value)))
              }
              onChangeCommitted={(_, value) => {
                const next = clampForceSpacing(clampSliderValue(value));
                setSpacingDraft(next);
                setSpacing(next);
              }}
            />
          </Box>
          <Box sx={{ width: 240 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              Minimum shared photos: {minWeightDraft}
            </Typography>
            <Slider
              size="small"
              min={weightSummary.min}
              max={weightSummary.max}
              step={1}
              value={minWeightDraft}
              disabled={weightSummary.min === weightSummary.max}
              valueLabelDisplay="auto"
              onChange={(_, value) => setMinWeightDraft(clampSliderValue(value))}
              onChangeCommitted={(_, value) => {
                const next = clampSliderValue(value);
                setMinWeightDraft(next);
                setMinWeight(next);
              }}
            />
          </Box>
          <Button variant="outlined" size="small" onClick={handleResetView}>
            Reset view
          </Button>
        </Box>
      </Box>

      <Box sx={{ position: "relative", flexGrow: 1, minHeight: 440 }}>
        {isLoading && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 2,
              backdropFilter: "blur(2px)",
              backgroundColor: alpha(theme.palette.background.paper, 0.4),
            }}
          >
            <CircularProgress size={32} />
          </Box>
        )}
        <Box
          ref={setContainerRef}
          sx={{
            width: "100%",
            height: "100%",
            borderRadius: 1,
            backgroundColor: alpha("#0D1321", 0.7),
          }}
        />
        {!isLoading && !hasGraph && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: 1,
              color: "text.secondary",
              px: 2,
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
          >
            <Typography variant="subtitle1">
              No relationships to display
            </Typography>
            <Typography variant="body2">
              Try selecting a shallower depth or lowering the minimum shared
              photo threshold.
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default PersonRelationshipGraph;
