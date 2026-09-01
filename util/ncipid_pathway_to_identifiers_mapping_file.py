#! /usr/bin/env python

import os
import re
import sys
import logging
import argparse
import pandas as pd
import re
from ndex2.client import Ndex2
from ndex2.cx2 import CX2Network

# This script is used to generate a mapping from pathway:<pathway_id> to NDEx URL for the network
# This is done by reading a network list of UUIDs, querying NDEx for pathway names and 
# parsing the merged ttl file for pathway names and identifiers



if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    # use argparse to parse command line arguments
    parser = argparse.ArgumentParser(description="Generate a mapping from pathway:<pathway_id> to NDEx URL")
    parser.add_argument("network_list_file", help="File containing list of network UUIDs")
    parser.add_argument("merged_ttl_file", help="Merged TTL file containing pathway names and identifiers")
    parser.add_argument("--output_file", default="pathway_redirects.csv", help="Output file for the mapping (default: pathway_to_ndex_url_mapping.txt)")  
    args = parser.parse_args()

    network_list_file = args.network_list_file
    merged_ttl_file = args.merged_ttl_file

    # Read network list file
    df_networks = pd.read_csv(network_list_file, header=0, names=['network_id'])

    network_uuids = df_networks['network_id'].tolist()

    # Create NDEx client
    ndex_client = Ndex2()

    # Create a mapping from pathway:<pathway_id> to NDEx URL
    pathway_name_to_url = {}
    pathway_id_to_url = {}

    for uuid in network_uuids:
        try:
            summary = ndex_client.get_network_summary(uuid)
            pathway_name = summary['name']      
            ndex_url = f"https://www.ndexbio.org/#/network/{uuid}"
            pathway_name_to_url[pathway_name] = ndex_url
        except Exception as e:
            logger.error(f"Error processing network {uuid}: {e}")

    with open(merged_ttl_file, 'r') as f:
        pathway_id = None
        pathway_name = None
        for line in f:
            
            if line.startswith('pathway:'):
                
                pathway_id = re.sub(' a biolink:Pathway;', '', re.sub(r'^pathway:', '', line.strip()))
            elif 'rdfs:label' in line:                
                # rdfs:label "Alpha4 beta1 integrin signaling events (v2.0)".
                pathway_name = re.sub('".$', '', re.sub('^.*rdfs:label "', '', line.strip()))               
                if pathway_name_to_url.get(pathway_name) is None:
                    continue
                else:
                    pathway_id_to_url[pathway_id] = pathway_name_to_url.get(pathway_name, None)


    # Output the mapping to a file
    output_file = args.output_file
    if output_file is None:
        for pathway_id, url in pathway_id_to_url.items():
            print(f"{pathway_id},{pathway_id},{url}")
    else:   
        with open(output_file, 'w') as f:
            f.write('ID,URL\n')
            for pathway_id, url in pathway_id_to_url.items():
                if pathway_id is None:
                    continue
                f.write(f"{pathway_id},{url}\n")

        logger.info(f"Mapping file generated: {output_file}")