const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodePtyFrame(agentId: string, body: Uint8Array): Uint8Array {
  const id = encoder.encode(agentId)
  const frame = new Uint8Array(1 + id.length + body.length)
  frame[0] = id.length
  frame.set(id, 1)
  frame.set(body, 1 + id.length)
  return frame
}

export function decodePtyFrame(frame: Uint8Array): { agentId: string; data: Uint8Array } {
  const end = 1 + frame[0]
  return { agentId: decoder.decode(frame.subarray(1, end)), data: frame.subarray(end) }
}
