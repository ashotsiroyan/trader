import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac } from 'node:crypto';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { Symbol } from './entities/symbol.entity';
import { History } from './entities/history.entity';
import { Side } from './enums/side.num';
import { Order } from './entities/order.entity';

@Injectable()
export class SymbolsService {
  private readonly logger = new Logger(SymbolsService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,

    @InjectRepository(Symbol)
    private symbolRepository: Repository<Symbol>,

    @InjectRepository(History)
    private historyRepository: Repository<History>,

    @InjectRepository(Order)
    private orderRepository: Repository<Order>
  ) {
    this.restartTimeouts();
  }

  async createSymbol(createSymbolDto: CreateSymbolDto) {
    const { name, listingDate } = createSymbolDto;

    const symbol = await this.symbolRepository.save({
      name: name.toUpperCase() + "USDT",
      listingDate: new Date(listingDate + "+4:00")
    });

    const timeoutMS = symbol.listingDate.getTime() - new Date().getTime() - 1000;

    if (timeoutMS > 0)
      this.addTimeout(symbol.name, timeoutMS, (name) => this.setStartPrice(name));

    return symbol;
  }

  private async setStartPrice(name: string) {
    const { MEXC_HOST } = process.env;
    const symbol = await this.symbolRepository.findOneBy({ name });

    if (symbol.isListed)
      return { success: false }

    let price = 0;

    while (price == 0) {
      const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${name}`);
      const data = await response.json();

      price = data.price;

      if (price == 0)
        await this.delay(100);
    }

    await this.buySymbol(symbol.id);

    symbol.isListed = true;
    symbol.priceOnStart = price;

    await this.symbolRepository.save(symbol);

    this.addTimeout(symbol.name, 1000 * 60, (name) => this.setMinutePrice(name));

    return { success: true };
  }

  private async setMinutePrice(name: string) {
    const { MEXC_HOST } = process.env;
    const symbol = await this.symbolRepository.findOneBy({ name });

    const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${name}`);
    const data = await response.json();

    symbol.priceOnMinute = data.price;

    await this.symbolRepository.save(symbol);

    return { success: true };
  }

  async restartTimeouts() {
    const symbols = await this.symbolRepository
      .createQueryBuilder('symbol')
      .where('symbol.isListed = false')
      .getMany();
      
    if (symbols.length > 0) {
      for (let symbol of symbols) {
        const timeoutMS = symbol.listingDate.getTime() - Date.now() - 1000;

        if (timeoutMS > 0)
          this.addTimeout(symbol.name, timeoutMS, (name) => this.setStartPrice(name));
      }

      this.logger.log("Timeouts restarted");
    } else
      this.logger.log("No timeout to restart");
  }

  async getStatistics() {
    const symbols = await this.symbolRepository.find({ where: { isFinished: true }, relations: { history: true } });
    const response = [];

    for (let i = 0; i < symbols.length; i++) {
      let symbol = symbols[i];

      response.push({
        symbol: symbol.name,
        priceOnStart: symbol.priceOnStart,
        priceOnMinute: symbol.priceOnMinute
      });

      for (let j = 0; (j < symbol.history.length && j < 24); j++)
        response[i][j + 1] = symbol.history[j].price;
    }

    return response;
  }

  private async buySymbol(symbolId: number) {
    const symbol = await this.symbolRepository.findOneBy({ id: symbolId });

    const queryParams: { key: string, value: string }[] = [
      {
        key: 'symbol',
        value: symbol.name
      },
      {
        key: 'side',
        value: Side.Buy
      },
      {
        key: 'type',
        value: 'MARKET'
      },
      {
        key: 'quoteOrderQty',
        value: '6'
      }
    ];

    const order = await this.createOrder(queryParams, symbol.id);

    if (!order)
      return { success: false }

    this.addTimeout(symbol.name, 1000 * 60 * 60, () => this.sellSymbol(order.id));

    return { success: true };
  }

  private async sellSymbol(orderId: number) {
    const order = await this.orderRepository.findOne({ where: { id: orderId }, relations: { symbol: true } })

    const queryParams: { key: string, value: string }[] = [
      {
        key: 'symbol',
        value: order.symbol.name
      },
      {
        key: 'side',
        value: Side.Sell
      },
      {
        key: 'type',
        value: 'MARKET'
      },
      {
        key: 'quantity',
        value: order.origQty
      }
    ];

    const newOrder = await this.createOrder(queryParams, order.symbol.id);

    return { success: newOrder != null };
  }

  private async createOrder(queryParams: { key: string, value: string }[], symbolId: number) {
    try {
      const { MEXC_API_KEY, MEXC_HOST } = process.env;

      const myHeaders = new Headers();
      myHeaders.append("x-mexc-apikey", MEXC_API_KEY);

      const requestOptions = {
        method: "POST",
        headers: myHeaders
      };

      const queryString = this.generateQueryString(queryParams);

      const response = await fetch(`${MEXC_HOST}/order?${queryString}`, requestOptions)
      const result = await response.json();

      if (result.msg)
        throw new BadRequestException(result.msg);

      const order = await this.orderRepository.save({
        orderId: result.orderId,
        symbol: {
          id: symbolId
        },
        price: result.price,
        origQty: result.origQty,
        side: result.side
      })

      return order;
    } catch (error) {
      console.error(error)

      return null;
    }
  }

  private addTimeout(name: string, milliseconds: number, callback: (name: string) => Promise<{ success: boolean }>) {
    if (this.schedulerRegistry.doesExist('timeout', name))
      this.schedulerRegistry.deleteTimeout(name);

    const timeout = setTimeout(() => callback(name), milliseconds);
    this.schedulerRegistry.addTimeout(name, timeout);
  }

  private generateQueryString(parameters: { key: string, value: string, disabled?: boolean }[]): string {
    const ts = Date.now();

    let paramsObject = {};
    let queryString;

    const { MEXC_API_SECRET: api_secret } = process.env;

    parameters.map((param) => {
      if (param.key != 'signature' &&
        param.key != 'timestamp' &&
        !is_empty(param.value) &&
        !is_disabled(param.disabled)) {
        paramsObject[param.key] = param.value;
      }
    })

    Object.assign(paramsObject, { 'timestamp': ts });

    if (api_secret) {
      queryString = Object.keys(paramsObject).map((key) => {
        return `${key}=${paramsObject[key]}`;
      }).join('&');

      const signature = createHmac('sha256', api_secret)
        .update(queryString)
        .digest('hex');

      queryString += "&signature=" + signature;
    }

    function is_disabled(str) {
      return str == true;
    }

    function is_empty(str) {
      if (typeof str == 'undefined' ||
        !str ||
        str.length === 0 ||
        str === "" ||
        !/[^\s]/.test(str) ||
        /^\s*$/.test(str) ||
        str.replace(/\s/g, "") === "") {
        return true;
      }
      else {
        return false;
      }
    }

    return queryString;
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  @Cron('0 * * * *')
  async addPrices() {
    const { MEXC_HOST } = process.env;

    const symbols = await this.symbolRepository.find({ where: { isFinished: false, isListed: true } });

    for (let symbol of symbols) {
      const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${symbol.name}`);
      const data = await response.json();

      await this.historyRepository.save({
        symbol,
        price: data.price
      });

      const { count } = await this.historyRepository
        .createQueryBuilder('history')
        .select('COUNT("symbolId") as "count"')
        .where('"symbolId" = ' + symbol.id)
        .groupBy('"symbolId"')
        .getRawOne();

      if (count >= 24) {
        symbol.isFinished = true;
        await this.symbolRepository.save(symbol);
      }
    }
  }
}
