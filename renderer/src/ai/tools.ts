// Canvas tool definitions for AI tool calling. These are sent to the
// QVAC SDK when tools are enabled, allowing the AI to create and
// modify shapes on the canvas automatically.
//
// Tool definitions are defined in the renderer and sent per-message
// to the main process via IPC. This follows the walrus-form-studio
// pattern where tools are renderer-owned.

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// Shape type for add_items tool
export interface ToolShape {
  type: 'rect' | 'ellipse' | 'text' | 'connector'
  x: number
  y: number
  w?: number
  h?: number
  text?: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  fontSize?: number
  // Connector-specific
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  label?: string
}

// Tool result from main process
export interface ToolResult {
  success: boolean
  error?: string
  items?: unknown[]
  count?: number
}

// Tool call event from AI stream
export interface ToolCallEvent {
  name: string
  arguments: Record<string, unknown>
}

// Canvas tool definitions
export const CANVAS_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    name: 'get_items',
    description:
      'Get all items on the current board. Use this to see what shapes exist before making changes.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    type: 'function',
    name: 'add_items',
    description:
      'Add shapes to the canvas. Supports rect, ellipse, text, connector, and note types. ' +
      'Use coordinates (x, y) for position, w/h for size, text for labels, fill/stroke for colors. ' +
      'For connectors, use startX/startY and endX/endY endpoints with an optional label. ' +
      'Notes are sticky notes with folded corners (yellow default).',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Array of shapes to add',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['rect', 'ellipse', 'text', 'connector', 'note'],
                description: 'Shape type'
              },
              x: {
                type: 'number',
                description: 'X position (left edge for rect/ellipse, start for connector)'
              },
              y: {
                type: 'number',
                description: 'Y position (top edge for rect/ellipse, start for connector)'
              },
              w: {
                type: 'number',
                description: 'Width (rect/ellipse/text only, default 160)'
              },
              h: {
                type: 'number',
                description: 'Height (rect/ellipse/text only, default 100)'
              },
              text: {
                type: 'string',
                description: 'Text label inside the shape'
              },
              fill: {
                type: 'string',
                description: 'Background color as hex (e.g., "#86efac" for green)'
              },
              stroke: {
                type: 'string',
                description: 'Border color as hex (default "#000000")'
              },
              strokeWidth: {
                type: 'number',
                description: 'Border width in pixels (default 2)'
              },
              fontSize: {
                type: 'number',
                description: 'Font size for text (default 12)'
              },
              startX: {
                type: 'number',
                description: 'Connector start X'
              },
              startY: {
                type: 'number',
                description: 'Connector start Y'
              },
              endX: {
                type: 'number',
                description: 'Connector end X'
              },
              endY: {
                type: 'number',
                description: 'Connector end Y'
              },
              label: {
                type: 'string',
                description: 'Label text for connector arrows'
              }
            },
            required: ['type', 'x', 'y']
          }
        }
      },
      required: ['items']
    }
  },
  {
    type: 'function',
    name: 'update_items',
    description:
      'Update properties of existing items by their id. ' +
      'The field for text/label content is called "text" (not "label").',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'Array of updates',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'ID of the item to update'
              },
              patch: {
                type: 'object',
                description:
                  'Fields to update: text (string), x (number), y (number), fill (hex color), stroke (hex color)'
              }
            },
            required: ['id', 'patch']
          }
        }
      },
      required: ['updates']
    }
  },
  {
    type: 'function',
    name: 'remove_items',
    description: 'Remove items from the canvas by their IDs.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          description: 'Array of item IDs to remove',
          items: {
            type: 'string'
          }
        }
      },
      required: ['ids']
    }
  }
]

// Knowledge Base search tool
export const KNOWLEDGE_BASE_TOOL: ToolDefinition = {
  type: 'function',
  name: 'search_knowledge_base',
  description:
    'Search the Knowledge Base for relevant documents. Use this when users ask about specific topics, data, or information that might be stored in the Knowledge Base.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant documents'
      },
      top_k: {
        type: 'number',
        description: 'Number of results to return (default: 5)'
      }
    },
    required: ['query']
  }
}

// Get tools for the current config
export function getToolsForConfig(toolsEnabled: boolean): ToolDefinition[] | undefined {
  return toolsEnabled ? CANVAS_TOOLS : undefined
}
