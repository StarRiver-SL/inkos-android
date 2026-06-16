package io.qzz.christmas.inkoslocal;

import android.content.Context;
import android.util.Log;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class EmbeddedPythonBridge {
    private static final String TAG = "InkOSPython";
    private final Context context;
    private final int port;
    private volatile boolean running = false;
    private ServerSocket serverSocket = null;
    private Thread thread = null;
    private String lastError = "";

    public EmbeddedPythonBridge(Context context, int port) {
        this.context = context.getApplicationContext();
        this.port = port;
    }

    public synchronized boolean start() {
        if (running) {
            return true;
        }
        try {
            ensurePythonStarted();
            serverSocket = new ServerSocket(port, 16, InetAddress.getByName("127.0.0.1"));
            running = true;
            thread = new Thread(this::serveLoop, "inkos-python-bridge");
            thread.setDaemon(true);
            thread.start();
            lastError = "";
            return true;
        } catch (Exception error) {
            lastError = error.getClass().getSimpleName() + ": " + error.getMessage();
            Log.w(TAG, "Unable to start embedded Python bridge", error);
            closeQuietly(serverSocket);
            serverSocket = null;
            running = false;
            return false;
        }
    }

    public synchronized void stop() {
        running = false;
        closeQuietly(serverSocket);
        serverSocket = null;
        thread = null;
    }

    public boolean isRunning() {
        return running;
    }

    public int getPort() {
        return port;
    }

    public String getLastError() {
        return lastError;
    }

    private void serveLoop() {
        while (running && serverSocket != null) {
            try {
                Socket socket = serverSocket.accept();
                Thread worker = new Thread(() -> handle(socket), "inkos-python-bridge-request");
                worker.setDaemon(true);
                worker.start();
            } catch (IOException error) {
                if (running) {
                    lastError = error.getClass().getSimpleName() + ": " + error.getMessage();
                    Log.w(TAG, "Embedded Python bridge accept failed", error);
                }
            }
        }
    }

    private void handle(Socket socket) {
        try (Socket closeable = socket) {
            closeable.setSoTimeout(15000);
            HttpRequest request = readRequest(closeable.getInputStream());
            if (request == null) {
                return;
            }
            if ("GET".equals(request.method) && "/status".equals(request.path)) {
                writeJson(closeable.getOutputStream(), 200, callPython("status", "{}"));
                return;
            }
            if ("POST".equals(request.method) && "/extract".equals(request.path)) {
                writeJson(closeable.getOutputStream(), 200, callPython("extract_json", request.body));
                return;
            }
            if ("POST".equals(request.method) && "/headroom".equals(request.path)) {
                writeJson(closeable.getOutputStream(), 200, callPython("headroom_compress_json", request.body));
                return;
            }
            if ("POST".equals(request.method) && "/maintenance".equals(request.path)) {
                writeJson(closeable.getOutputStream(), 200, callPython("inkos_maintenance", "scan_json", request.body));
                return;
            }
            if ("POST".equals(request.method) && "/quality".equals(request.path)) {
                writeJson(closeable.getOutputStream(), 200, callPython("inkos_quality", "quality_json", request.body));
                return;
            }
            writeJson(closeable.getOutputStream(), 404, "{\"ok\":false,\"error\":\"not-found\"}");
        } catch (Exception error) {
            lastError = error.getClass().getSimpleName() + ": " + error.getMessage();
            Log.w(TAG, "Embedded Python bridge request failed", error);
            try {
                writeJson(socket.getOutputStream(), 500, "{\"ok\":false,\"error\":\"" + escapeJson(lastError) + "\"}");
            } catch (Exception ignored) {
            }
        }
    }

    private String callPython(String functionName, String payload) {
        return callPython("inkos_extract", functionName, payload);
    }

    private String callPython(String moduleName, String functionName, String payload) {
        try {
            ensurePythonStarted();
            PyObject module = Python.getInstance().getModule(moduleName);
            PyObject result = module.callAttr(functionName, payload == null ? "{}" : payload);
            return result == null ? "{\"ok\":false,\"error\":\"empty-python-result\"}" : result.toString();
        } catch (Exception error) {
            lastError = error.getClass().getSimpleName() + ": " + error.getMessage();
            Log.w(TAG, "Embedded Python call failed", error);
            return "{\"ok\":false,\"error\":\"" + escapeJson(lastError) + "\"}";
        }
    }

    private void ensurePythonStarted() {
        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(context));
        }
    }

    private HttpRequest readRequest(InputStream input) throws IOException {
        ByteArrayOutputStream headerBytes = new ByteArrayOutputStream();
        int matched = 0;
        byte[] marker = new byte[] { '\r', '\n', '\r', '\n' };
        while (headerBytes.size() < 65536) {
            int value = input.read();
            if (value == -1) {
                return null;
            }
            headerBytes.write(value);
            matched = value == marker[matched] ? matched + 1 : (value == marker[0] ? 1 : 0);
            if (matched == marker.length) {
                break;
            }
        }
        String headers = headerBytes.toString(StandardCharsets.ISO_8859_1.name());
        String[] lines = headers.split("\\r?\\n");
        if (lines.length == 0) {
            return null;
        }
        String[] start = lines[0].split(" ");
        if (start.length < 2) {
            return null;
        }
        int contentLength = 0;
        for (String line : lines) {
            int colon = line.indexOf(':');
            if (colon <= 0) {
                continue;
            }
            String key = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            if ("content-length".equals(key)) {
                try {
                    contentLength = Math.max(0, Integer.parseInt(line.substring(colon + 1).trim()));
                } catch (NumberFormatException ignored) {
                    contentLength = 0;
                }
            }
        }
        byte[] bodyBytes = readExact(input, contentLength);
        String path = start[1];
        int queryIndex = path.indexOf('?');
        if (queryIndex >= 0) {
            path = path.substring(0, queryIndex);
        }
        return new HttpRequest(start[0].toUpperCase(Locale.ROOT), path, new String(bodyBytes, StandardCharsets.UTF_8));
    }

    private byte[] readExact(InputStream input, int length) throws IOException {
        byte[] data = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = input.read(data, offset, length - offset);
            if (read == -1) {
                break;
            }
            offset += read;
        }
        if (offset == length) {
            return data;
        }
        byte[] partial = new byte[offset];
        System.arraycopy(data, 0, partial, 0, offset);
        return partial;
    }

    private void writeJson(OutputStream output, int status, String json) throws IOException {
        byte[] body = (json == null ? "{}" : json).getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : (status == 404 ? "Not Found" : "Error");
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII));
        output.write(body);
        output.flush();
    }

    private static void closeQuietly(ServerSocket socket) {
        if (socket == null) {
            return;
        }
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }

    private static String escapeJson(String value) {
        try {
            return JSONObject.quote(value == null ? "" : value).replaceAll("^\"|\"$", "");
        } catch (Exception ignored) {
            return "";
        }
    }

    private static final class HttpRequest {
        final String method;
        final String path;
        final String body;

        HttpRequest(String method, String path, String body) {
            this.method = method;
            this.path = path;
            this.body = body;
        }
    }
}
