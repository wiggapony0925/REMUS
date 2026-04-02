// ─────────────────────────────────────────────────────────────
// Remus — Status Bar Component
// Premium terminal status display
// ─────────────────────────────────────────────────────────────

import React from 'react';
import { Text, Box } from 'ink';
import type { SessionStats } from '../services/queryEngine.js';

interface StatusBarProps {
  model: string;
  provider: string;
  stats: SessionStats;
  cwd: string;
  isStreaming?: boolean;
  cost?: string;
}

export function StatusBar({ model, provider, stats, cwd, isStreaming, cost }: StatusBarProps): React.ReactElement {
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const tokens = stats.totalInputTokens + stats.totalOutputTokens;
  const tokenStr = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

  // Shorten cwd
  const home = process.env.HOME ?? '';
  const shortCwd = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  const sep = ' │ ';

  return (
    <Box borderStyle="round" borderColor={isStreaming ? 'yellow' : '#FF6B35'} paddingX={1} justifyContent="space-between">
      <Text>
        <Text color={isStreaming ? 'yellow' : '#FF6B35'} bold>{isStreaming ? '⟳ ' : '⬡ '}</Text>
        <Text color="white" bold>Remus</Text>
        <Text color="gray" dimColor> │ </Text>
        <Text color="gray">{shortCwd}</Text>
      </Text>
      <Text>
        <Text color="#FF8C42">{model}</Text>
        <Text color="gray" dimColor>{sep}</Text>
        <Text color="cyan">{provider}</Text>
        <Text color="gray" dimColor>{sep}</Text>
        <Text color="white">{tokenStr}</Text>
        <Text color="gray" dimColor> tok</Text>
        {cost && cost !== '$0.00' && (
          <>
            <Text color="gray" dimColor>{sep}</Text>
            <Text color="yellow" bold>{cost}</Text>
          </>
        )}
        <Text color="gray" dimColor>{sep}</Text>
        <Text color="green">{stats.toolCalls}</Text>
        <Text color="gray" dimColor> calls</Text>
        <Text color="gray" dimColor>{sep}</Text>
        <Text color="gray">{elapsed}s</Text>
      </Text>
    </Box>
  );
}
