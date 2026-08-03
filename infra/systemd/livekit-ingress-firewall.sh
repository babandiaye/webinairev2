#!/bin/sh
# ═══════════════════════════════════════════════════════════════
#  Referme les ports internes de LiveKit Ingress sur le loopback
# ═══════════════════════════════════════════════════════════════
#
# Le conteneur livekit_ingress tourne en network_mode: host — impose par le
# WHIP, qui a besoin de l'UDP en direct — et LiveKit Ingress ne sait pas
# choisir son adresse d'ecoute : son binaire ne connait que rtmp_port,
# whip_port, health_port et http_relay_port, aucune cle de bind (verifie dans
# /usr/bin/ingress). Ces trois ports se retrouvent donc sur 0.0.0.0 alors
# qu'aucun n'a de client legitime hors de la machine. Le pare-feu est le seul
# endroit ou les refermer.
#
#   1935  RTMP EN CLAIR. Unique client : stunnel, qui termine le RTMPS public
#         (1936, certificat *.unchk.sn) et se reconnecte en 127.0.0.1:1935
#         — voir /etc/stunnel/rtmps.conf. Aucune application ne distribue
#         d'URL rtmp:// : livekit-server.yaml ne publie que rtmp_base_url en
#         rtmps://...:1936.
#   8085  Serveur WHIP. Unique client : nginx, en proxy_pass
#         http://127.0.0.1:8085 sur le vhost preprod-webinairertc
#         (whip_base_url = https://.../whip). Le media WHIP, lui, passe en UDP
#         50000-50200 (rtc_config) et n'est pas concerne par une regle TCP.
#   9091  Controle de sante (/ -> Healthy, /availability -> Available). Prevu
#         pour un repartiteur de charge devant plusieurs instances ; il n'y en
#         a qu'une ici et aucune supervision ne l'interroge (verifie par
#         capture iptables LOG avant fermeture).
#
# 9090 (http_relay_port) est deja lie a 127.0.0.1 par LiveKit lui-meme, rien
# a faire pour lui.
#
# ip6tables autant qu'iptables : ces sockets sont en dual-stack (ss les
# affiche en *:port), une regle IPv4 seule les laisserait joignables en IPv6.
#
# RETOUR ARRIERE : systemctl disable --now livekit-ingress-firewall, puis pour
# chaque port P de la liste ci-dessous :
#   iptables  -D INPUT -p tcp --dport P ! -i lo -j DROP
#   ip6tables -D INPUT -p tcp --dport P ! -i lo -j DROP

set -e

PORTS="1935 8085 9091"

for port in $PORTS; do
    for cmd in iptables ip6tables; do
        command -v "$cmd" >/dev/null 2>&1 || continue
        # -C d'abord : le service est idempotent, un redemarrage ne doit pas
        # empiler la meme regle. Insere en tete plutot qu'ajoute a la fin — la
        # chaine INPUT compte quelques milliers de DROP par IP source, inutile
        # de les traverser tous pour chaque paquet destine a ces ports.
        "$cmd" -C INPUT -p tcp --dport "$port" ! -i lo -j DROP 2>/dev/null ||
            "$cmd" -I INPUT 1 -p tcp --dport "$port" ! -i lo -j DROP
    done
done
