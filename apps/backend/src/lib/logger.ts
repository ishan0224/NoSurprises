export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  domain?: string;
  origin?: string | null;
  latencyMs?: number;
  cacheHit?: boolean;
  [key: string]: unknown;
}

interface LogRecord extends LogContext {
  timestamp: string;
  level: LogLevel;
  message: string;
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  };

  const serialized = JSON.stringify(record);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    write("debug", message, context);
  },
  info(message: string, context?: LogContext): void {
    write("info", message, context);
  },
  warn(message: string, context?: LogContext): void {
    write("warn", message, context);
  },
  error(message: string, context?: LogContext): void {
    write("error", message, context);
  }
};
