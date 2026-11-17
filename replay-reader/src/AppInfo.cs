namespace ChestCounter;

/// <summary>
/// The few names TreasureCatalog.cs (copied from LED-N/Fortnite-ChestCounter) refers to.
/// chest-replay never downloads anything: it only reads the replay it is given.
/// </summary>
public static class AppInfo
{
    public static Version Version { get; } = typeof(AppInfo).Assembly.GetName().Version ?? new Version(1, 0, 0);
    public static string VersionText => $"{Version.Major}.{Version.Minor}.{Math.Max(0, Version.Build)}";
    public const string Repo = "LED-N/Fortnite-ChestCounter";
    public static string RepoUrl => "https://github.com/" + Repo;
}
