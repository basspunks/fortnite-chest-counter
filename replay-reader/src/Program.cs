// chest-replay <file.replay>
// Prints one line of JSON about the match in the replay, for the Chest Counter app:
//   {"ok":true,"chests":12,"ammoBoxes":3,"counts":true,"mode":"...","player":"...","startUtc":"...","seconds":1234}
//   {"ok":false,"error":"..."}   when the replay cannot be read (still being written, unknown format...)
// "counts" is false for modes where chests are not part of the treasure hunt (ranked, creative, LTMs...).
using System.Text.Json;
using ChestCounter;

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: chest-replay <file.replay>");
    return 1;
}

try
{
    byte[] bytes;
    // the game may still hold the file open: share it
    using (var file = new FileStream(args[0], FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
    {
        bytes = new byte[file.Length];
        file.ReadExactly(bytes);
    }
    using var stream = new MemoryStream(bytes, writable: false);
    // "": the replay's owner is the player, as replays saved on a PC are its player's
    var match = new ReplayAnalyzer().Analyze(stream, Path.GetFileName(args[0]), "");
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        ok = true,
        chests = match.ChestsOpened,
        // of them, broken (pickaxe, explosion, vehicle) rather than opened
        destroyed = match.Chests.Count(chest => chest.Destroyed),
        ammoBoxes = match.AmmoBoxesOpened,
        counts = GameModes.Counts(match),
        mode = match.Playlist,
        player = match.PlayerName,
        startUtc = match.MatchStartUtc,
        seconds = match.DurationSeconds,
        vehicleChestsMissing = match.VehicleChestsMissing,
        // chests by kind, with short keys for the app
        kinds = match.Chests.GroupBy(chest => KindKey(chest.Kind)).ToDictionary(group => group.Key, group => group.Count()),
        // seconds into the match of each chest, to tell which ones were opened during a Treasure Hour
        chestSeconds = match.Chests.Select(chest => Math.Round(chest.TimeSeconds, 1)),
        // each chest: when, what kind, and whether it was broken rather than opened (no opening sound then);
        // used to check the sound detector against real matches
        chestList = match.Chests.Select(chest => new { seconds = Math.Round(chest.TimeSeconds, 1), kind = KindKey(chest.Kind), destroyed = chest.Destroyed }),
        // treasure hunt rewards the player got; prizeId names the prize in content.json when it is known
        treasures = match.TreasureFinds.Select(find => new
        {
            prizeId = find.PrizeId,
            item = find.Item,
            golden = find.FromGoldenChest,
            seconds = find.ObtainedAtSeconds,
        }),
        teamChests = match.TeamChestsOpened,
    }));
    return 0;
}
catch (Exception error)
{
    Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = error.Message }));
    return 2;
}

static string KindKey(string kind) => kind switch
{
    ChestKinds.Normal => "normal",
    ChestKinds.Rare => "rare",
    ChestKinds.Buried => "buried",
    ChestKinds.Extraction => "spirit",
    ChestKinds.PosterChest => "poster",
    _ => "other",
};
