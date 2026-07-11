import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RoomServiceClient, EgressClient, IngressClient } from "livekit-server-sdk";

// Point unique de construction des clients LiveKit — évite de dupliquer la
// dérivation wss://→https:// et les credentials dans chaque module.
@Injectable()
export class LiveKitClientsService {
  public readonly roomService: RoomServiceClient;
  public readonly egressClient: EgressClient;
  public readonly ingressClient: IngressClient;

  constructor(config: ConfigService) {
    const wsUrl = config.get<string>("livekit.wsUrl")!;
    const apiKey = config.get<string>("livekit.apiKey")!;
    const apiSecret = config.get<string>("livekit.apiSecret")!;
    const httpUrl = wsUrl.replace(/^ws/, "http");

    this.roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    this.egressClient = new EgressClient(httpUrl, apiKey, apiSecret);
    this.ingressClient = new IngressClient(httpUrl, apiKey, apiSecret);
  }
}
