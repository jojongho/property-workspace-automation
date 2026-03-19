import os
import argparse
import yaml
import re
from pathlib import Path

# 설정된 옵시디언 볼트 경로
VAULT_PATH = "/Users/cao25/Projects/Obsidian-Database"

def extract_frontmatter(file_path):
    """마크다운 파일에서 YAML Frontmatter 추출"""
    frontmatter = {}
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # YAML 영역 추출 정규식
            match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
            if match:
                yaml_content = match.group(1)
                try:
                    frontmatter = yaml.safe_load(yaml_content) or {}
                except yaml.YAMLError:
                    pass
    except Exception:
        pass
    return frontmatter

def search_properties(args):
    """조건에 맞는 매물 검색"""
    results = []
    
    # 볼트 내 모든 마크다운 파일 탐색 (.obsidian 시스템 폴더 제외)
    for root, dirs, files in os.walk(VAULT_PATH):
        if '.obsidian' in root or '- System' in root:
            continue
            
        for file in files:
            if not file.endswith('.md'):
                continue
                
            file_path = os.path.join(root, file)
            props = extract_frontmatter(file_path)
            
            if not props:
                continue
            
            # 필터링 로직
            match = True
            
            # 1. 매물 유형(type) 필터
            if args.type and props.get('type') != args.type:
                match = False
                
            # 2. 상태 필터
            if args.status and props.get('상태') != args.status:
                match = False
                
            # 3. 거래유형 필터
            if args.trade_type and props.get('거래유형') != args.trade_type:
                match = False
                
            # 4. 최대/최소 가격 필터 (매매가, 전세가, 보증금 등)
            if args.max_price is not None or args.min_price is not None:
                # 가격 관련 키 찾기 (우선순위: 매매가 -> 전세가 -> 보증금)
                price = None
                for price_key in ['매매가', '전세가', '보증금']:
                    val = props.get(price_key)
                    if val is not None:
                        try:
                            # 문자열인 경우 숫자만 추출 (예: "50000", "50000.0" -> 50000.0)
                            if isinstance(val, str):
                                val_clean = re.sub(r'[^\d.]', '', val)
                                if val_clean:
                                    price = float(val_clean)
                            else:
                                price = float(val)
                            break
                        except ValueError:
                            pass
                            
                if price is not None:
                    if args.max_price is not None and price > args.max_price:
                        match = False
                    if args.min_price is not None and price < args.min_price:
                        match = False
                else:
                    # 가격 정보가 없는 경우, 가격 필터가 있으면 제외
                    match = False

            # 5. 텍스트 검색 (주소, 이름 등)
            if args.keyword:
                keyword = args.keyword.lower()
                text_match = False
                # 속성 값에서 검색
                for val in props.values():
                    if isinstance(val, str) and keyword in val.lower():
                        text_match = True
                        break
                # 파일명에서 검색
                if keyword in file.lower():
                    text_match = True
                    
                if not text_match:
                    match = False

            if match:
                results.append({
                    "file": file,
                    "path": os.path.relpath(file_path, VAULT_PATH),
                    "props": props
                })
                
    return results

def main():
    parser = argparse.ArgumentParser(description="옵시디언 부동산 매물 데이터 필터링 스크립트")
    parser.add_argument('-t', '--type', type=str, help="매물 유형 (예: 상가, 건물, 아파트매물, 주택)")
    parser.add_argument('-s', '--status', type=str, help="상태 (예: 진행중, 계약완료)")
    parser.add_argument('-tr', '--trade-type', type=str, help="거래유형 (예: 매매, 전세, 월세)")
    parser.add_argument('-min', '--min-price', type=float, help="최소 가격")
    parser.add_argument('-max', '--max-price', type=float, help="최대 가격")
    parser.add_argument('-k', '--keyword', type=str, help="키워드 검색 (주소, 단지명 등)")
    
    args = parser.parse_args()
    
    print(f"🔍 검색 조건: {args}")
    results = search_properties(args)
    
    print(f"\n✅ 검색 결과: 총 {len(results)}건")
    print("-" * 60)
    
    # 결과 출력
    for r in results[:20]: # 너무 길면 최대 20개만 출력
        props = r['props']
        name = props.get('건물명', props.get('단지명', props.get('명칭', r['file'].replace('.md', ''))))
        price_info = f"매매가: {props.get('매매가', '-')} " if '매매가' in props else ""
        price_info += f"보증금/월세: {props.get('보증금', '-')}/{props.get('월세', '-')} " if '보증금' in props else ""
        
        print(f"[{props.get('type', '알수없음')}] {name}")
        print(f"  📍 주소: {props.get('주소', '-')}")
        print(f"  💰 가격: {price_info.strip()}")
        print(f"  🏷️ 상태: {props.get('상태', '-')} | 거래유형: {props.get('거래유형', '-')}")
        print(f"  📄 파일경로: {r['path']}")
        print("-" * 60)
        
    if len(results) > 20:
        print(f"... 외 {len(results) - 20}건의 결과가 더 있습니다.")

if __name__ == "__main__":
    main()
