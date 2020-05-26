import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { ElectrsApiService } from '../../services/electrs-api.service';
import { switchMap, filter, catchError, take } from 'rxjs/operators';
import { Asset, Transaction } from '../../interfaces/electrs.interface';
import { WebsocketService } from 'src/app/services/websocket.service';
import { StateService } from 'src/app/services/state.service';
import { AudioService } from 'src/app/services/audio.service';
import { ApiService } from 'src/app/services/api.service';
import { of, merge, Subscription, combineLatest } from 'rxjs';
import { SeoService } from 'src/app/services/seo.service';
import { environment } from 'src/environments/environment';
import { AssetsService } from 'src/app/services/assets.service';

@Component({
  selector: 'app-asset',
  templateUrl: './asset.component.html',
  styleUrls: ['./asset.component.scss']
})
export class AssetComponent implements OnInit, OnDestroy {
  network = '';
  nativeAssetId = environment.nativeAssetId;

  asset: Asset;
  assetContract: any;
  assetString: string;
  isLoadingAsset = true;
  transactions: Transaction[];
  isLoadingTransactions = true;
  isNativeAsset = false;
  error: any;
  mainSubscription: Subscription;

  totalConfirmedTxCount = 0;
  loadedConfirmedTxCount = 0;
  txCount = 0;
  receieved = 0;
  sent = 0;

  private tempTransactions: Transaction[];
  private timeTxIndexes: number[];
  private lastTransactionTxId: string;

  constructor(
    private route: ActivatedRoute,
    private electrsApiService: ElectrsApiService,
    private websocketService: WebsocketService,
    private stateService: StateService,
    private audioService: AudioService,
    private apiService: ApiService,
    private seoService: SeoService,
    private assetsService: AssetsService,
  ) { }

  ngOnInit() {
    this.websocketService.want(['blocks', 'stats', 'mempool-blocks']);
    this.stateService.networkChanged$.subscribe((network) => this.network = network);

    this.mainSubscription = this.route.paramMap
      .pipe(
        switchMap((params: ParamMap) => {
          this.error = undefined;
          this.isLoadingAsset = true;
          this.loadedConfirmedTxCount = 0;
          this.asset = null;
          this.assetContract = null;
          this.isLoadingTransactions = true;
          this.transactions = null;
          document.body.scrollTo(0, 0);
          this.assetString = params.get('id') || '';
          this.seoService.setTitle('Asset: ' + this.assetString, true);

          return merge(
            of(true),
            this.stateService.connectionState$
              .pipe(filter((state) => state === 2 && this.transactions && this.transactions.length > 0))
          )
          .pipe(
            switchMap(() => {
              return combineLatest([this.electrsApiService.getAsset$(this.assetString)
                .pipe(
                  catchError((err) => {
                    this.isLoadingAsset = false;
                    this.error = err;
                    console.log(err);
                    return of(null);
                  })
                ), this.assetsService.getAssetsMinimalJson$])
              .pipe(
                take(1)
              );
            })
          );
        })
      )
      .pipe(
        switchMap(([asset, assetsData]) => {
          this.asset = asset;
          this.assetContract = assetsData[this.asset.asset_id];
          this.isNativeAsset = asset.asset_id === this.nativeAssetId;
          this.updateChainStats();
          this.websocketService.startTrackAsset(asset.asset_id);
          this.isLoadingAsset = false;
          this.isLoadingTransactions = true;
          return this.electrsApiService.getAssetTransactions$(asset.asset_id);
        }),
        switchMap((transactions) => {
          this.tempTransactions = transactions;
          if (transactions.length) {
            this.lastTransactionTxId = transactions[transactions.length - 1].txid;
            this.loadedConfirmedTxCount += transactions.filter((tx) => tx.status.confirmed).length;
          }

          const fetchTxs: string[] = [];
          this.timeTxIndexes = [];
          transactions.forEach((tx, index) => {
            if (!tx.status.confirmed) {
              fetchTxs.push(tx.txid);
              this.timeTxIndexes.push(index);
            }
          });
          if (!fetchTxs.length) {
            return of([]);
          }
          return this.apiService.getTransactionTimes$(fetchTxs);
        })
      )
      .subscribe((times: number[]) => {
        times.forEach((time, index) => {
          this.tempTransactions[this.timeTxIndexes[index]].firstSeen = time;
        });
        this.tempTransactions.sort((a, b) => {
          return b.status.block_time - a.status.block_time || b.firstSeen - a.firstSeen;
        });

        this.transactions = this.tempTransactions;
        this.isLoadingTransactions = false;
      },
      (error) => {
        console.log(error);
        this.error = error;
        this.isLoadingAsset = false;
      });

    this.stateService.mempoolTransactions$
      .subscribe((transaction) => {
        if (this.transactions.some((t) => t.txid === transaction.txid)) {
          return;
        }

        this.transactions.unshift(transaction);
        this.transactions = this.transactions.slice();
        this.txCount++;

        this.audioService.playSound('chime');
      });

    this.stateService.blockTransactions$
      .subscribe((transaction) => {
        const tx = this.transactions.find((t) => t.txid === transaction.txid);
        if (tx) {
          tx.status = transaction.status;
          this.transactions = this.transactions.slice();
          this.audioService.playSound('magic');
        }
        this.totalConfirmedTxCount++;
        this.loadedConfirmedTxCount++;
      });
  }

  loadMore() {
    if (this.isLoadingTransactions || !this.totalConfirmedTxCount || this.loadedConfirmedTxCount >= this.totalConfirmedTxCount) {
      return;
    }
    this.isLoadingTransactions = true;
    this.electrsApiService.getAssetTransactionsFromHash$(this.asset.asset_id, this.lastTransactionTxId)
      .subscribe((transactions: Transaction[]) => {
        this.lastTransactionTxId = transactions[transactions.length - 1].txid;
        this.loadedConfirmedTxCount += transactions.length;
        this.transactions = this.transactions.concat(transactions);
        this.isLoadingTransactions = false;
      });
  }

  updateChainStats() {
    // this.receieved = this.asset.chain_stats.funded_txo_sum + this.asset.mempool_stats.funded_txo_sum;
    // this.sent = this.asset.chain_stats.spent_txo_sum + this.asset.mempool_stats.spent_txo_sum;
    this.txCount = this.asset.chain_stats.tx_count + this.asset.mempool_stats.tx_count;
    this.totalConfirmedTxCount = this.asset.chain_stats.tx_count;
  }

  ngOnDestroy() {
    this.mainSubscription.unsubscribe();
    this.websocketService.stopTrackingAsset();
  }
}