# Captures the sound of ONE program (and the programs it started) and writes it to stdout as
# 16-bit mono PCM at 24 kHz, the format the chest detector uses.
# Uses Windows "process loopback" (Windows 10 version 2004 or newer), the same thing OBS uses for
# Application Audio Capture. The C# below is compiled by PowerShell itself, so no build tools are needed.
# Exit codes: 0 = the program closed (or the app stopped listening); 3 = that program is not running;
# 2 + a message on stderr = Windows cannot capture one program's sound here (for example an older Windows).
param([Parameter(Mandatory = $true)][int]$ProcessId)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class AppAudio
{
    const int SampleRate = 24000;

    [StructLayout(LayoutKind.Sequential)]
    struct ActivationParams { public int Type; public int TargetProcessId; public int Mode; }

    [StructLayout(LayoutKind.Sequential)]
    struct Blob { public int Size; public IntPtr Data; }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant { public short Vt; public short R1; public short R2; public short R3; public Blob Blob; }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WaveFormat
    {
        public short Tag; public short Channels; public int SamplesPerSec; public int AvgBytesPerSec;
        public short BlockAlign; public short BitsPerSample; public short Size;
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int result, [MarshalAs(UnmanagedType.IUnknown)] out object activated);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
    }

    // Marker: the completion handler may be called from any thread.
    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAgileObject { }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        void Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        void GetBufferSize(out uint frames);
        void GetStreamLatency(out long latency);
        void GetCurrentPadding(out uint padding);
        void IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        void GetMixFormat(out IntPtr format);
        void GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        void Start();
        void Stop();
        void Reset();
        void SetEventHandle(IntPtr handle);
        void GetService([MarshalAs(UnmanagedType.LPStruct)] Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        void GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        void ReleaseBuffer(uint frames);
        void GetNextPacketSize(out uint frames);
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation operation);

    class Done : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Finished = new ManualResetEvent(false);
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation) { Finished.Set(); }
    }

    public static int Run(int processId)
    {
        try
        {
            Capture(processId);
            return 0;
        }
        catch (IOException)
        {
            return 0; // the app closed the pipe: stop quietly
        }
        catch (ArgumentException)
        {
            return 3; // the program is not running (any more)
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 2;
        }
    }

    static IAudioClient Activate(int processId)
    {
        var parameters = new ActivationParams { Type = 1, TargetProcessId = processId, Mode = 0 }; // process loopback, include child processes
        IntPtr parametersMemory = Marshal.AllocHGlobal(Marshal.SizeOf(parameters));
        IntPtr variantMemory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PropVariant)));
        try
        {
            Marshal.StructureToPtr(parameters, parametersMemory, false);
            var variant = new PropVariant { Vt = 65, Blob = new Blob { Size = Marshal.SizeOf(parameters), Data = parametersMemory } }; // VT_BLOB
            Marshal.StructureToPtr(variant, variantMemory, false);
            var done = new Done();
            IActivateAudioInterfaceAsyncOperation operation;
            ActivateAudioInterfaceAsync("VAD\\Process_Loopback", typeof(IAudioClient).GUID, variantMemory, done, out operation);
            if (!done.Finished.WaitOne(5000)) throw new TimeoutException("Windows did not answer the audio request.");
            int result;
            object activated;
            operation.GetActivateResult(out result, out activated);
            Marshal.ThrowExceptionForHR(result);
            return (IAudioClient)activated;
        }
        finally
        {
            Marshal.FreeHGlobal(parametersMemory);
            Marshal.FreeHGlobal(variantMemory);
        }
    }

    static void Capture(int processId)
    {
        Process target = Process.GetProcessById(processId);
        IAudioClient client = Activate(processId);

        var format = new WaveFormat { Tag = 1, Channels = 1, SamplesPerSec = SampleRate, AvgBytesPerSec = SampleRate * 2, BlockAlign = 2, BitsPerSample = 16, Size = 0 };
        IntPtr formatMemory = Marshal.AllocHGlobal(Marshal.SizeOf(format));
        Marshal.StructureToPtr(format, formatMemory, false);
        // loopback + event callback + let Windows convert to our format
        const int flags = unchecked((int)(0x00020000 | 0x00040000 | 0x80000000 | 0x08000000));
        client.Initialize(0, flags, 2000000, 0, formatMemory, IntPtr.Zero);

        var ready = new AutoResetEvent(false);
        client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle());
        object service;
        client.GetService(typeof(IAudioCaptureClient).GUID, out service);
        var capture = (IAudioCaptureClient)service;

        Stream output = Console.OpenStandardOutput();
        byte[] bytes = new byte[0];
        client.Start();
        while (!target.HasExited)
        {
            ready.WaitOne(200);
            uint frames;
            capture.GetNextPacketSize(out frames);
            while (frames > 0)
            {
                IntPtr data;
                uint got, bufferFlags;
                ulong devicePosition, qpcPosition;
                capture.GetBuffer(out data, out got, out bufferFlags, out devicePosition, out qpcPosition);
                int length = (int)got * 2;
                if (bytes.Length != length) bytes = new byte[length];
                if ((bufferFlags & 0x2) != 0) Array.Clear(bytes, 0, length); // silent
                else Marshal.Copy(data, bytes, 0, length);
                capture.ReleaseBuffer(got);
                output.Write(bytes, 0, length);
                capture.GetNextPacketSize(out frames);
            }
            output.Flush();
        }
        client.Stop();
    }
}
'@

exit [AppAudio]::Run($ProcessId)
