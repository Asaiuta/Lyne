import { createMemo } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import {
  BooleanSettingItem,
  ButtonSettingItem,
  SelectSettingItem,
  type SelectOption
} from "../components/SettingControls";
import { settingsSectionClass } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";

interface NetworkSectionProps {
  highlightId: string | null;
}

export function NetworkSection(props: NetworkSectionProps) {
  const { t } = useTranslation();

  const proxyProtocolOptions = createMemo<SelectOption[]>(() => [
    { value: "http", label: t("settings.network.proxyProtocol.http") },
    { value: "socks5", label: t("settings.network.proxyProtocol.socks5") }
  ]);

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.network.streaming.title")}>
        <BooleanSettingItem
          id="streamingEnabled"
          label={t("settings.network.streamingEnabled")}
          description={t("settings.network.streamingEnabled.desc")}
          highlighted={isHi("streamingEnabled")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <ButtonSettingItem
          id="streamingServerList"
          label={t("settings.network.streamingServerList")}
          description={t("settings.network.streamingServerList.desc")}
          highlighted={isHi("streamingServerList")}
          index={nextIndex()}
          buttonLabel={t("settings.network.streamingServerList.action")}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.network.proxy.title")}>
        <SelectSettingItem
          id="proxyProtocol"
          label={t("settings.network.proxyProtocol")}
          highlighted={isHi("proxyProtocol")}
          index={nextIndex()}
          value="http"
          options={proxyProtocolOptions()}
          wip
        />
        <ButtonSettingItem
          id="proxyServer"
          label={t("settings.network.proxyServer")}
          highlighted={isHi("proxyServer")}
          index={nextIndex()}
          buttonLabel={t("settings.network.proxyServer.action")}
          wip
        />
        <ButtonSettingItem
          id="proxyTest"
          label={t("settings.network.proxyTest")}
          highlighted={isHi("proxyTest")}
          index={nextIndex()}
          buttonLabel={t("settings.network.proxyTest.action")}
          wip
        />
        <BooleanSettingItem
          id="useRealIP"
          label={t("settings.network.useRealIP")}
          description={t("settings.network.useRealIP.desc")}
          highlighted={isHi("useRealIP")}
          index={nextIndex()}
          checked={false}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.network.lastfm.title")}>
        <BooleanSettingItem
          id="lastfmEnabled"
          label={t("settings.network.lastfmEnabled")}
          highlighted={isHi("lastfmEnabled")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <ButtonSettingItem
          id="lastfmConnect"
          label={t("settings.network.lastfmConnect")}
          highlighted={isHi("lastfmConnect")}
          index={nextIndex()}
          buttonLabel={t("settings.network.lastfmConnect.action")}
          wip
        />
        <BooleanSettingItem
          id="lastfmScrobble"
          label={t("settings.network.lastfmScrobble")}
          highlighted={isHi("lastfmScrobble")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <BooleanSettingItem
          id="lastfmNowplaying"
          label={t("settings.network.lastfmNowplaying")}
          highlighted={isHi("lastfmNowplaying")}
          index={nextIndex()}
          checked={false}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.network.discord.title")}>
        <BooleanSettingItem
          id="discordEnabled"
          label={t("settings.network.discordEnabled")}
          description={t("settings.network.discordEnabled.desc")}
          highlighted={isHi("discordEnabled")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <BooleanSettingItem
          id="discordPaused"
          label={t("settings.network.discordPaused")}
          highlighted={isHi("discordPaused")}
          index={nextIndex()}
          checked={false}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.network.socket.title")}>
        <BooleanSettingItem
          id="socketEnabled"
          label={t("settings.network.socketEnabled")}
          description={t("settings.network.socketEnabled.desc")}
          highlighted={isHi("socketEnabled")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <ButtonSettingItem
          id="socketTest"
          label={t("settings.network.socketTest")}
          highlighted={isHi("socketTest")}
          index={nextIndex()}
          buttonLabel={t("settings.network.socketTest.action")}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.network.other.title")}>
        <BooleanSettingItem
          id="smtcOpen"
          label={t("settings.network.smtcOpen")}
          description={t("settings.network.smtcOpen.desc")}
          highlighted={isHi("smtcOpen")}
          index={nextIndex()}
          checked={false}
          wip
        />
      </SettingGroup>
    </section>
  );
}
